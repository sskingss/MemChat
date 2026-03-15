import { milvusService } from './milvus.service';
import { embeddingService } from './embedding.service';
import { llmService } from './llm.service';
import { chunkingService } from './chunking.service';
import { memoryCleanupService } from './memory-cleanup.service';
import { config } from '../config';
import type {
  MemoryUpdateDecision,
  MemoryUpdateResult,
  SimilarMemoryContext,
  MemoryType,
  MemoryCategory,
  MemoryPipelineFact,
} from '../types';

// 默认值（可通过 config 覆盖）
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_MAX_SIMILAR_MEMORIES = 8;

/**
 * 记忆管理服务（企业级升级版）
 *
 * 核心改进：
 *
 * 1. 【Pipeline 写入】两次 LLM 调用合并为一次
 *    旧流程: embed(summary) → search → LLM importance → LLM update decision
 *    新流程: embed(userMessage) → search → LLM pipeline (一次完成所有决策)
 *    收益：减少约 50% LLM 延迟，同时支持批量提取多条事实
 *
 * 2. 【混合检索】向量 + 关键词 + 时间衰减 + 重要性的综合评分
 *    旧流程: 纯向量相似度 topK=5
 *    新流程: 拉取 topK×3 候选 → 多维评分 → 重排 → 取 topK
 *    收益：更准确的检索，避免语义相似但语境不匹配的噪音
 *
 * 3. 【嵌入缓存】相同文本复用向量
 *    chat 阶段对 userMessage 生成的向量，在 processAndStoreMemory 阶段命中缓存
 *    收益：消除重复的嵌入推理开销
 *
 * 4. 【认知分类】semantic/episodic/procedural/todo 四类记忆
 *    收益：更细粒度的记忆管理，为未来的分类检索奠定基础
 */
export class MemoryService {
  /**
   * 处理对话后的记忆存储（Pipeline 版本）
   *
   * 流程：
   * 1. 对 userMessage 生成向量（大概率命中缓存，因为 RAG 阶段已生成）
   * 2. 检索相似记忆（为 LLM 提供上下文）
   * 3. 单次 LLM 调用：提取所有事实 + 决定 create/update/merge/skip
   * 4. 执行决策
   * 5. 异步检查是否需要清理
   *
   * @returns 实际写入的记忆条数
   */
  async processAndStoreMemory(
    userId: string,
    workspaceId: string,
    userMessage: string,
    assistantReply: string
  ): Promise<number> {
    try {
      // 1. 生成向量（利用缓存，避免重复推理）
      const queryVector = await embeddingService.generateEmbedding(userMessage);

      // 2. 检索相似记忆，为 LLM 提供上下文
      const topK = config.memory.similarityTopK ?? DEFAULT_MAX_SIMILAR_MEMORIES;
      const threshold = config.memory.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

      const similarMemories = await milvusService.searchSimilarMemoriesWithThreshold(
        userId,
        workspaceId,
        queryVector,
        topK,
        threshold
      );

      console.log(`[Memory] 找到 ${similarMemories.length} 条相似记忆，传入 Pipeline`);

      const similarContext: SimilarMemoryContext[] = similarMemories.map(m => ({
        id: m.id,
        content: m.content,
        score: m.score,
      }));

      // 3. 单次 LLM 调用（原来需要两次）
      const pipelineResult = await llmService.processMemoryPipeline(
        userMessage,
        assistantReply,
        similarContext
      );

      if (!pipelineResult.facts || pipelineResult.facts.length === 0) {
        console.log('[Memory] Pipeline: 无需存储任何记忆');
        return 0;
      }

      const actionableFacts = pipelineResult.facts.filter(f => f.action !== 'skip');

      if (actionableFacts.length === 0) {
        console.log('[Memory] Pipeline: 所有事实均已存在，跳过');
        return 0;
      }

      // 4. 执行每条事实的存储决策
      let storedCount = 0;
      for (const fact of actionableFacts) {
        try {
          const result = await this.executePipelineFact(
            userId,
            workspaceId,
            fact
          );
          if (result.action !== 'skipped') {
            storedCount++;
          }
          console.log(`[Memory] 事实[${fact.category}] ${result.action}: ${fact.content.substring(0, 60)}...`);
        } catch (err) {
          console.error('[Memory] 执行 Pipeline 事实失败:', err);
        }
      }

      // 5. 异步检查是否需要清理（不阻塞主流程）
      memoryCleanupService.checkAndCleanup(userId).catch(err => {
        console.error('[Memory] 清理检查失败:', err);
      });

      return storedCount;
    } catch (error) {
      console.error('[Memory] 存储记忆失败:', error);
      return 0;
    }
  }

  /**
   * 执行单条 Pipeline 事实的存储动作
   */
  private async executePipelineFact(
    userId: string,
    workspaceId: string,
    fact: MemoryPipelineFact
  ): Promise<MemoryUpdateResult> {
    const content = fact.actionContent || fact.content;
    const memoryType: MemoryType = fact.category === 'todo' ? 'todo' : 'general';
    const { importanceScore, expiresAt, category } = fact;

    switch (fact.action) {
      case 'create': {
        const vector = await embeddingService.generateEmbedding(content);
        const id = await milvusService.insertMemory(
          userId, workspaceId, content, vector,
          memoryType, expiresAt, importanceScore, 0, category
        );
        return { action: 'created', memoryIds: [id], reason: '新事实' };
      }

      case 'update': {
        if (!fact.targetMemoryId) {
          // 降级为创建
          const vector = await embeddingService.generateEmbedding(content);
          const id = await milvusService.insertMemory(
            userId, workspaceId, content, vector,
            memoryType, expiresAt, importanceScore, 0, category
          );
          return { action: 'created', memoryIds: [id], reason: 'update 缺少 targetMemoryId，降级为创建' };
        }

        const updatedVector = await embeddingService.generateEmbedding(content);
        const success = await milvusService.updateMemory(
          userId, fact.targetMemoryId, content, updatedVector, importanceScore
        );

        if (!success) {
          const id = await milvusService.insertMemory(
            userId, workspaceId, content, updatedVector,
            memoryType, expiresAt, importanceScore, 0, category
          );
          return { action: 'created', memoryIds: [id], reason: '更新失败，降级为创建' };
        }

        return { action: 'updated', memoryIds: [fact.targetMemoryId], reason: '更新已有记忆' };
      }

      case 'merge': {
        if (!fact.targetMemoryIds || fact.targetMemoryIds.length === 0) {
          const vector = await embeddingService.generateEmbedding(content);
          const id = await milvusService.insertMemory(
            userId, workspaceId, content, vector,
            memoryType, expiresAt, importanceScore, 0, category
          );
          return { action: 'created', memoryIds: [id], reason: 'merge 缺少 targetMemoryIds，降级为创建' };
        }

        try {
          const mergedVector = await embeddingService.generateEmbedding(content);
          const newId = await milvusService.mergeMemories(
            userId, workspaceId,
            fact.targetMemoryIds,
            content,
            mergedVector,
            importanceScore
          );
          return { action: 'merged', memoryIds: [newId], reason: '合并多条记忆' };
        } catch (err) {
          const vector = await embeddingService.generateEmbedding(content);
          const id = await milvusService.insertMemory(
            userId, workspaceId, content, vector,
            memoryType, expiresAt, importanceScore, 0, category
          );
          return { action: 'created', memoryIds: [id], reason: '合并失败，降级为创建' };
        }
      }

      default:
        return { action: 'skipped', memoryIds: [], reason: '未知动作' };
    }
  }

  /**
   * 检索相关记忆（混合检索版本）
   *
   * 检索策略：
   * 1. 从 Milvus 拉取 topK × candidateMultiplier 条候选
   * 2. 计算多维综合分数：向量相似度 + 关键词匹配 + 时间衰减 + 重要性
   * 3. 按综合分数重排，返回 topK 条
   * 4. 异步更新命中记忆的访问统计
   */
  async retrieveRelevantMemories(
    userId: string,
    workspaceId: string,
    query: string,
    topK: number = 5
  ): Promise<Array<{ content: string; createdAt: number }>> {
    try {
      const queryVector = await embeddingService.generateEmbedding(query);

      // 拉取更多候选，用于 reranking
      const multiplier = config.retrieval.candidateMultiplier;
      const candidateCount = topK * multiplier;

      const candidates = await milvusService.searchSimilarMemories(
        userId,
        workspaceId,
        queryVector,
        candidateCount
      );

      if (candidates.length === 0) return [];

      // 多维评分 + 重排
      const scored = candidates.map(mem => {
        const vectorSim = this.computeVectorSimilarity(mem.score);
        const keywordScore = this.computeKeywordScore(query, mem.content);
        const timeDecay = this.computeTimeDecay(mem.createdAt);
        const importanceSim = mem.importanceScore / 10;

        const { vectorWeight, keywordWeight, timeDecayWeight, importanceWeight } = config.retrieval;

        const finalScore =
          vectorWeight * vectorSim +
          keywordWeight * keywordScore +
          timeDecayWeight * timeDecay +
          importanceWeight * importanceSim;

        return { ...mem, finalScore };
      });

      // 按综合分数降序排列
      scored.sort((a, b) => b.finalScore - a.finalScore);
      const results = scored.slice(0, topK);

      // 异步更新访问统计
      if (results.length > 0) {
        const hitIds = results.map(m => m.id);
        milvusService.updateMemoryAccessStats(userId, hitIds).catch(err => {
          console.error('[Memory] 更新访问统计失败:', err);
        });
      }

      console.log(`[Memory] 混合检索: 候选=${candidates.length}, 返回=${results.length}`);

      return results.map(mem => ({
        content: mem.content,
        createdAt: mem.createdAt,
      }));
    } catch (error) {
      console.error('[Memory] 检索记忆失败:', error);
      return [];
    }
  }

  // ============ 混合检索辅助方法 ============

  /**
   * L2 距离转相似度（归一化到 0-1）
   *
   * 对于 384 维归一化向量：L2 ∈ [0, 2]
   * - 0  → 完全相同 → similarity = 1
   * - 2  → 完全相反 → similarity = 0
   */
  private computeVectorSimilarity(l2Distance: number): number {
    return Math.max(0, 1 - l2Distance / 2);
  }

  /**
   * 关键词匹配得分（轻量 BM25 近似）
   *
   * 将查询分词后计算在文档中的覆盖率
   * 支持中英文混合分词
   */
  private computeKeywordScore(query: string, document: string): number {
    // 简单分词：按空格、标点切分，过滤短词
    const tokenize = (text: string): Set<string> => {
      return new Set(
        text
          .toLowerCase()
          .split(/[\s，。、？！,.?!;:；：\-_/\\]+/)
          .filter(t => t.length > 1)
      );
    };

    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return 0;

    const docLower = document.toLowerCase();
    let matches = 0;

    for (const token of queryTokens) {
      if (docLower.includes(token)) matches++;
    }

    return matches / queryTokens.size;
  }

  /**
   * 时间衰减得分（指数衰减）
   *
   * 遵循 Ebbinghaus 遗忘曲线启发设计：
   * score = exp(-ln(2) * age_days / halfLife)
   * - 刚创建：score ≈ 1.0
   * - halfLifeDays 天后：score ≈ 0.5
   * - 无限远：score → 0
   */
  private computeTimeDecay(createdAt: number): number {
    const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
    const halfLifeDays = config.retrieval.halfLifeDays;
    return Math.exp(-Math.LN2 * ageDays / halfLifeDays);
  }

  // ============ 兼容旧版接口（保留供外部调用）============

  /**
   * 执行记忆更新决策（旧版，保留向后兼容）
   */
  private async executeMemoryDecision(
    userId: string,
    workspaceId: string,
    decision: MemoryUpdateDecision,
    vector: number[],
    memoryType: MemoryType = 'general',
    expiresAt: number = 0,
    importanceScore: number = 5
  ): Promise<MemoryUpdateResult> {
    switch (decision.action) {
      case 'create': {
        const content = decision.newContent || '';
        const chunks = chunkingService.chunkText(content);
        const memoryIds: string[] = [];

        for (const chunk of chunks) {
          const chunkVector = await embeddingService.generateEmbedding(chunk);
          const id = await milvusService.insertMemory(
            userId, workspaceId, chunk, chunkVector,
            memoryType, expiresAt, importanceScore
          );
          memoryIds.push(id);
        }

        return { action: 'created', memoryIds, reason: decision.reason };
      }

      case 'update': {
        if (!decision.targetMemoryId || !decision.updatedContent) {
          return this.executeMemoryDecision(userId, workspaceId, {
            action: 'create',
            reason: 'UPDATE 参数缺失，降级为创建',
            newContent: decision.updatedContent || decision.newContent || '',
          }, vector, memoryType, expiresAt, importanceScore);
        }

        const updatedVector = await embeddingService.generateEmbedding(decision.updatedContent);
        const success = await milvusService.updateMemory(
          userId, decision.targetMemoryId, decision.updatedContent, updatedVector, importanceScore
        );

        if (!success) {
          const id = await milvusService.insertMemory(
            userId, workspaceId, decision.updatedContent, updatedVector,
            memoryType, expiresAt, importanceScore
          );
          return { action: 'created', memoryIds: [id], reason: '更新失败，降级为创建' };
        }

        return { action: 'updated', memoryIds: [decision.targetMemoryId], reason: decision.reason };
      }

      case 'merge': {
        if (!decision.targetMemoryIds || decision.targetMemoryIds.length === 0 || !decision.mergedContent) {
          return this.executeMemoryDecision(userId, workspaceId, {
            action: 'create',
            reason: 'MERGE 参数缺失，降级为创建',
            newContent: decision.mergedContent || decision.newContent || '',
          }, vector, memoryType, expiresAt, importanceScore);
        }

        try {
          const mergedVector = await embeddingService.generateEmbedding(decision.mergedContent);
          const newId = await milvusService.mergeMemories(
            userId, workspaceId,
            decision.targetMemoryIds,
            decision.mergedContent,
            mergedVector,
            importanceScore
          );
          return { action: 'merged', memoryIds: [newId], reason: decision.reason };
        } catch (error) {
          const id = await milvusService.insertMemory(
            userId, workspaceId, decision.mergedContent, vector,
            memoryType, expiresAt, importanceScore
          );
          return { action: 'created', memoryIds: [id], reason: '合并失败，降级为创建' };
        }
      }

      default:
        return this.executeMemoryDecision(userId, workspaceId, {
          action: 'create',
          reason: '未知操作类型，降级为创建',
          newContent: decision.newContent || '',
        }, vector, memoryType, expiresAt, importanceScore);
    }
  }
}

export const memoryService = new MemoryService();
