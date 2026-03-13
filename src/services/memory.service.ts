import { milvusService } from './milvus.service';
import { embeddingService } from './embedding.service';
import { llmService } from './llm.service';
import { chunkingService } from './chunking.service';
import { memoryCleanupService } from './memory-cleanup.service';
import { config } from '../config';
import type { MemoryUpdateDecision, MemoryUpdateResult, SimilarMemoryContext, MemoryType } from '../types';

// 默认值（可通过 config 覆盖）
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_MAX_SIMILAR_MEMORIES = 8;

/**
 * 记忆管理服务
 *
 * 负责：
 * 1. 判断对话信息是否值得存储为长期记忆
 * 2. 智能更新：相似记忆检索 → LLM 决策 → 创建/更新/合并
 */
export class MemoryService {
  /**
   * 处理对话后的记忆存储（智能更新版本）
   *
   * 流程：
   * 1. 调用 LLM 判断重要性
   * 2. 如果重要，生成摘要
   * 3. 检索相似记忆
   * 4. LLM 判断是否需要合并/更新
   * 5. 执行相应的存储/更新/合并操作
   *
   * @returns 是否存储了记忆
   */
  async processAndStoreMemory(
    userId: string,
    workspaceId: string,
    userMessage: string,
    assistantReply: string
  ): Promise<boolean> {
    try {
      // 1. 判断是否值得存储
      const importance = await llmService.evaluateMemoryImportance(
        userMessage,
        assistantReply
      );

      if (!importance.isImportant || !importance.summary) {
        console.log(`[Memory] 不重要，跳过存储: ${importance.reason}`);
        return false;
      }

      const summary = importance.summary;
      const memoryType: MemoryType = importance.memoryType || 'general';
      const expiresAt: number = importance.expiresAt || 0;
      const importanceScore: number = importance.importanceScore ?? 5;

      console.log(`[Memory] 记忆类型: ${memoryType}, 重要性: ${importanceScore}, 过期时间: ${expiresAt || 'never'}`);

      // 2. 生成向量并检索相似记忆（使用可配置的窗口和阈值）
      const summaryVector = await embeddingService.generateEmbedding(summary);

      const topK = config.memory.similarityTopK ?? DEFAULT_MAX_SIMILAR_MEMORIES;
      const threshold = config.memory.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

      const similarMemories = await milvusService.searchSimilarMemoriesWithThreshold(
        userId,
        workspaceId,
        summaryVector,
        topK,
        threshold
      );

      console.log(`[Memory] 找到 ${similarMemories.length} 条相似记忆`);

      // 3. 转换为 LLM 需要的格式
      const similarContext: SimilarMemoryContext[] = similarMemories.map(m => ({
        id: m.id,
        content: m.content,
        score: m.score,
      }));

      // 4. LLM 判断更新策略
      const decision = await llmService.evaluateMemoryUpdate(summary, similarContext);

      console.log(`[Memory] 决策: ${decision.action}, 原因: ${decision.reason}`);

      // 5. 执行相应的操作
      const result = await this.executeMemoryDecision(
        userId,
        workspaceId,
        decision,
        summaryVector,
        memoryType,
        expiresAt,
        importanceScore
      );

      console.log(`[Memory] 执行结果: ${result.action}, IDs: ${result.memoryIds.join(', ')}`);

      // 6. 异步检查是否需要清理（不阻塞主流程）
      memoryCleanupService.checkAndCleanup(userId).catch(err => {
        console.error('[Memory] 清理检查失败:', err);
      });

      return true;
    } catch (error) {
      console.error('[Memory] 存储记忆失败:', error);
      return false;
    }
  }

  /**
   * 执行记忆更新决策
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
        const stats = chunkingService.getChunkStats(chunks);
        const memoryIds: string[] = [];

        console.log(`[Memory] 创建新记忆: ${stats.chunks} chunks, type=${memoryType}, score=${importanceScore}`);

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
          console.error('[Memory] UPDATE 操作缺少必要参数，降级为创建');
          return this.executeMemoryDecision(userId, workspaceId, {
            action: 'create',
            reason: 'UPDATE 参数缺失，降级为创建',
            newContent: decision.updatedContent || decision.newContent || '',
          }, vector, memoryType, expiresAt, importanceScore);
        }

        console.log(`[Memory] 更新记忆: ${decision.targetMemoryId}`);

        const updatedVector = await embeddingService.generateEmbedding(decision.updatedContent);
        const success = await milvusService.updateMemory(
          userId,
          decision.targetMemoryId,
          decision.updatedContent,
          updatedVector,
          importanceScore
        );

        if (!success) {
          console.warn('[Memory] 更新失败，降级为创建新记忆');
          const id = await milvusService.insertMemory(
            userId, workspaceId, decision.updatedContent, updatedVector,
            memoryType, expiresAt, importanceScore
          );
          return { action: 'created', memoryIds: [id], reason: '更新失败，降级为创建新记忆' };
        }

        return { action: 'updated', memoryIds: [decision.targetMemoryId], reason: decision.reason };
      }

      case 'merge': {
        if (!decision.targetMemoryIds || decision.targetMemoryIds.length === 0 || !decision.mergedContent) {
          console.error('[Memory] MERGE 操作缺少必要参数，降级为创建');
          return this.executeMemoryDecision(userId, workspaceId, {
            action: 'create',
            reason: 'MERGE 参数缺失，降级为创建',
            newContent: decision.mergedContent || decision.newContent || '',
          }, vector, memoryType, expiresAt, importanceScore);
        }

        console.log(`[Memory] 合并记忆: ${decision.targetMemoryIds.join(', ')}`);

        const mergedVector = await embeddingService.generateEmbedding(decision.mergedContent);

        try {
          const newId = await milvusService.mergeMemories(
            userId, workspaceId,
            decision.targetMemoryIds,
            decision.mergedContent,
            mergedVector,
            importanceScore
          );
          return { action: 'merged', memoryIds: [newId], reason: decision.reason };
        } catch (error) {
          console.error('[Memory] 合并失败，降级为创建新记忆:', error);
          const id = await milvusService.insertMemory(
            userId, workspaceId, decision.mergedContent, mergedVector,
            memoryType, expiresAt, importanceScore
          );
          return { action: 'created', memoryIds: [id], reason: '合并失败，降级为创建新记忆' };
        }
      }

      default:
        console.error(`[Memory] 未知的操作类型: ${(decision as any).action}`);
        return this.executeMemoryDecision(userId, workspaceId, {
          action: 'create',
          reason: '未知操作类型，降级为创建',
          newContent: decision.newContent || '',
        }, vector, memoryType, expiresAt, importanceScore);
    }
  }

  /**
   * 检索相关记忆（RAG）
   *
   * 检索后异步更新命中记忆的 access_count 和 last_accessed_at，
   * 用于后续清理时的综合评分计算。
   */
  async retrieveRelevantMemories(
    userId: string,
    workspaceId: string,
    query: string,
    topK: number = 5
  ): Promise<Array<{ content: string; createdAt: number }>> {
    try {
      const queryVector = await embeddingService.generateEmbedding(query);

      const memories = await milvusService.searchSimilarMemories(
        userId,
        workspaceId,
        queryVector,
        topK
      );

      // 异步更新访问统计，不阻塞主流程
      if (memories.length > 0) {
        const hitIds = memories.map(m => m.id);
        milvusService.updateMemoryAccessStats(userId, hitIds).catch(err => {
          console.error('[Memory] 更新访问统计失败:', err);
        });
      }

      return memories.map((mem) => ({
        content: mem.content,
        createdAt: mem.createdAt,
      }));
    } catch (error) {
      console.error('[Memory] 检索记忆失败:', error);
      return [];
    }
  }
}

export const memoryService = new MemoryService();
