import { milvusService } from './milvus.service';
import { embeddingService } from './embedding.service';
import { llmService } from './llm.service';
import { chunkingService } from './chunking.service';
import { memoryCleanupService } from './memory-cleanup.service';
import type { MemoryUpdateDecision, MemoryUpdateResult, SimilarMemoryContext, MemoryType } from '../types';

// 配置常量
const SIMILARITY_THRESHOLD = 1.0; // L2 距离阈值（越小越相似）
const MAX_SIMILAR_MEMORIES = 3;   // 最多检索的相似记忆数

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

      console.log(`[Memory] 记忆类型: ${memoryType}, 过期时间: ${expiresAt || 'never'}`);

      // 2. 生成向量并检索相似记忆
      const summaryVector = await embeddingService.generateEmbedding(summary);

      const similarMemories = await milvusService.searchSimilarMemoriesWithThreshold(
        userId,
        workspaceId,
        summaryVector,
        MAX_SIMILAR_MEMORIES,
        SIMILARITY_THRESHOLD
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
        expiresAt
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
    expiresAt: number = 0
  ): Promise<MemoryUpdateResult> {
    switch (decision.action) {
      case 'create': {
        // 分块并创建新记忆
        const content = decision.newContent || '';
        const chunks = chunkingService.chunkText(content);
        const stats = chunkingService.getChunkStats(chunks);
        const memoryIds: string[] = [];

        console.log(`[Memory] 创建新记忆: ${stats.chunks} chunks, type=${memoryType}`);

        for (const chunk of chunks) {
          const chunkVector = await embeddingService.generateEmbedding(chunk);
          const id = await milvusService.insertMemory(userId, workspaceId, chunk, chunkVector, memoryType, expiresAt);
          memoryIds.push(id);
        }

        return {
          action: 'created',
          memoryIds,
          reason: decision.reason,
        };
      }

      case 'update': {
        if (!decision.targetMemoryId || !decision.updatedContent) {
          console.error('[Memory] UPDATE 操作缺少必要参数，降级为创建');
          // 降级为创建新记忆
          return this.executeMemoryDecision(userId, workspaceId, {
            action: 'create',
            reason: 'UPDATE 参数缺失，降级为创建',
            newContent: decision.updatedContent || decision.newContent || '',
          }, vector, memoryType, expiresAt);
        }

        console.log(`[Memory] 更新记忆: ${decision.targetMemoryId}`);

        const updatedVector = await embeddingService.generateEmbedding(decision.updatedContent);
        const success = await milvusService.updateMemory(
          userId,
          decision.targetMemoryId,
          decision.updatedContent,
          updatedVector
        );

        if (!success) {
          // 更新失败，降级为创建新记忆
          console.warn('[Memory] 更新失败，降级为创建新记忆');
          const id = await milvusService.insertMemory(
            userId,
            workspaceId,
            decision.updatedContent,
            updatedVector,
            memoryType,
            expiresAt
          );
          return {
            action: 'created',
            memoryIds: [id],
            reason: '更新失败，降级为创建新记忆',
          };
        }

        return {
          action: 'updated',
          memoryIds: [decision.targetMemoryId],
          reason: decision.reason,
        };
      }

      case 'merge': {
        if (!decision.targetMemoryIds || decision.targetMemoryIds.length === 0 || !decision.mergedContent) {
          console.error('[Memory] MERGE 操作缺少必要参数，降级为创建');
          return this.executeMemoryDecision(userId, workspaceId, {
            action: 'create',
            reason: 'MERGE 参数缺失，降级为创建',
            newContent: decision.mergedContent || decision.newContent || '',
          }, vector, memoryType, expiresAt);
        }

        console.log(`[Memory] 合并记忆: ${decision.targetMemoryIds.join(', ')}`);

        const mergedVector = await embeddingService.generateEmbedding(decision.mergedContent);

        try {
          const newId = await milvusService.mergeMemories(
            userId,
            workspaceId,
            decision.targetMemoryIds,
            decision.mergedContent,
            mergedVector
          );

          return {
            action: 'merged',
            memoryIds: [newId],
            reason: decision.reason,
          };
        } catch (error) {
          // 合并失败，降级为创建新记忆
          console.error('[Memory] 合并失败，降级为创建新记忆:', error);
          const id = await milvusService.insertMemory(
            userId,
            workspaceId,
            decision.mergedContent,
            mergedVector,
            memoryType,
            expiresAt
          );
          return {
            action: 'created',
            memoryIds: [id],
            reason: '合并失败，降级为创建新记忆',
          };
        }
      }

      default:
        // 未知的操作类型，降级为创建
        console.error(`[Memory] 未知的操作类型: ${(decision as any).action}`);
        return this.executeMemoryDecision(userId, workspaceId, {
          action: 'create',
          reason: '未知操作类型，降级为创建',
          newContent: decision.newContent || '',
        }, vector, memoryType, expiresAt);
    }
  }

  /**
   * 检索相关记忆（RAG）
   *
   * @param userId 用户 ID（强制隔离）
   * @param workspaceId 工作空间 ID
   * @param query 查询文本
   * @param topK 返回 top K 个最相关的记忆
   */
  async retrieveRelevantMemories(
    userId: string,
    workspaceId: string,
    query: string,
    topK: number = 5
  ): Promise<Array<{ content: string; createdAt: number }>> {
    try {
      // 1. 将查询向量化
      const queryVector = await embeddingService.generateEmbedding(query);

      // 2. 从 Milvus 检索相似记忆
      // 【隔离保证】强制过滤 userId 和 workspaceId
      const memories = await milvusService.searchSimilarMemories(
        userId,
        workspaceId,
        queryVector,
        topK
      );

      // 3. 返回带时间戳的记忆
      return memories.map((mem) => ({
        content: mem.content,
        createdAt: mem.createdAt,
      }));
    } catch (error) {
      console.error('[Memory] 检索记忆失败:', error);
      // 检索失败返回空数组，不影响对话
      return [];
    }
  }
}

export const memoryService = new MemoryService();
