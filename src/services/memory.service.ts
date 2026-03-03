import { milvusService } from './milvus.service';
import { embeddingService } from './embedding.service';
import { llmService } from './llm.service';
import { chunkingService } from './chunking.service';

/**
 * 记忆管理服务
 *
 * 负责：
 * 1. 判断对话信息是否值得存储为长期记忆
 * 2. 如果值得，提取摘要并存储到 Milvus
 */
export class MemoryService {
  /**
   * 处理对话后的记忆存储
   *
   * 流程：
   * 1. 调用 LLM 判断重要性
   * 2. 如果重要，生成摘要并向量化
   * 3. 存储到 Milvus（强制绑定 userId 和 workspaceId）
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

      // 2. 使用 Chunking 策略处理长文本
      const summary = importance.summary;
      const chunks = chunkingService.chunkText(summary);
      const stats = chunkingService.getChunkStats(chunks);

      console.log(`[Memory] Chunking summary into ${stats.chunks} chunks (avg ${stats.avgTokens.toFixed(0)} tokens)`);

      // 3. 为每个 chunk 生成向量并存储
      let storedCount = 0;
      for (const chunk of chunks) {
        const vector = await embeddingService.generateEmbedding(chunk);

        // 【隔离保证】userId 和 workspaceId 强制绑定
        const memoryId = await milvusService.insertMemory(
          userId,
          workspaceId,
          chunk,
          vector
        );

        storedCount++;
        console.log(`[Memory] Stored chunk ${storedCount}/${stats.chunks}: ${chunk.substring(0, 50)}...`);
      }

      console.log(`[Memory] 完成存储 ${storedCount} 个记忆 chunks`);
      return true;
    } catch (error) {
      // 记忆存储失败不应该影响主流程
      console.error('[Memory] 存储记忆失败:', error);
      return false;
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
  ): Promise<string[]> {
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

      // 3. 提取记忆内容
      return memories.map((mem) => mem.content);
    } catch (error) {
      console.error('[Memory] 检索记忆失败:', error);
      // 检索失败返回空数组，不影响对话
      return [];
    }
  }
}

export const memoryService = new MemoryService();
