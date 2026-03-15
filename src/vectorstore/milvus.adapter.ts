import { milvusService } from '../services/milvus.service';
import type { IVectorStore, InsertMemoryParams, SearchParams } from './types';
import type { MemoryQueryResult, MemoryWithVector, CompressionLevel } from '../types';

/**
 * Milvus 向量库适配器
 *
 * 将 MilvusService 的接口适配到 IVectorStore 抽象层
 */
export class MilvusAdapter implements IVectorStore {
  async init(): Promise<void> {
    await milvusService.initCollection();
  }

  async insertMemory(params: InsertMemoryParams): Promise<string> {
    return milvusService.insertMemory(
      params.userId,
      params.workspaceId,
      params.content,
      params.vector,
      params.memoryType || 'general',
      params.expiresAt || 0,
      params.importanceScore || 5,
      params.compressionLevel || 0,
      params.memoryCategory
    );
  }

  async searchSimilar(params: SearchParams): Promise<MemoryQueryResult[]> {
    return milvusService.searchSimilarMemories(
      params.userId,
      params.workspaceId,
      params.queryVector,
      params.topK
    );
  }

  async searchSimilarWithThreshold(params: SearchParams & { threshold: number }): Promise<MemoryQueryResult[]> {
    return milvusService.searchSimilarMemoriesWithThreshold(
      params.userId,
      params.workspaceId,
      params.queryVector,
      params.topK,
      params.threshold
    );
  }

  async getMemoriesByWorkspace(userId: string, workspaceId: string): Promise<MemoryQueryResult[]> {
    return milvusService.getMemoriesByWorkspace(userId, workspaceId);
  }

  async updateMemory(userId: string, memoryId: string, newContent: string, newVector: number[], importanceScore?: number): Promise<boolean> {
    return milvusService.updateMemory(userId, memoryId, newContent, newVector, importanceScore);
  }

  async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    return milvusService.deleteMemory(userId, memoryId);
  }

  async deleteMemoriesByIds(userId: string, memoryIds: string[]): Promise<number> {
    return milvusService.deleteMemoriesByIds(userId, memoryIds);
  }

  async mergeMemories(userId: string, workspaceId: string, memoryIds: string[], mergedContent: string, mergedVector: number[], importanceScore: number, compressionLevel?: CompressionLevel): Promise<string> {
    return milvusService.mergeMemories(userId, workspaceId, memoryIds, mergedContent, mergedVector, importanceScore, compressionLevel || 0);
  }

  async countMemories(userId: string, workspaceId?: string): Promise<number> {
    return milvusService.countMemories(userId, workspaceId);
  }

  async deleteExpiredMemories(): Promise<number> {
    return milvusService.deleteExpiredMemories();
  }

  async getMemoriesForCleanup(userId: string, limit: number): Promise<MemoryQueryResult[]> {
    return milvusService.getMemoriesForCleanup(userId, limit);
  }

  async getAllMemoriesWithVectors(userId: string, compressionLevelFilter?: CompressionLevel): Promise<MemoryWithVector[]> {
    return milvusService.getAllMemoriesWithVectors(userId, compressionLevelFilter);
  }

  async updateMemoryAccessStats(userId: string, memoryIds: string[]): Promise<void> {
    return milvusService.updateMemoryAccessStats(userId, memoryIds);
  }
}
