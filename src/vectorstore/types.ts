import type { MemoryType, CompressionLevel, MemoryQueryResult, MemoryWithVector } from '../types';

/**
 * 向量存储层抽象接口
 *
 * 所有向量数据库实现（Milvus、pgvector 等）必须实现此接口，
 * 使上层服务与底层存储解耦。
 */
export interface IVectorStore {
  /** 初始化 collection/table */
  init(): Promise<void>;

  /** 插入一条记忆 */
  insertMemory(params: InsertMemoryParams): Promise<string>;

  /** 向量相似度搜索 */
  searchSimilar(params: SearchParams): Promise<MemoryQueryResult[]>;

  /** 带阈值的相似度搜索 */
  searchSimilarWithThreshold(params: SearchParams & { threshold: number }): Promise<MemoryQueryResult[]>;

  /** 获取 workspace 下所有记忆 */
  getMemoriesByWorkspace(userId: string, workspaceId: string): Promise<MemoryQueryResult[]>;

  /** 更新记忆内容 */
  updateMemory(userId: string, memoryId: string, newContent: string, newVector: number[], importanceScore?: number): Promise<boolean>;

  /** 删除单条记忆 */
  deleteMemory(userId: string, memoryId: string): Promise<boolean>;

  /** 批量删除记忆 */
  deleteMemoriesByIds(userId: string, memoryIds: string[]): Promise<number>;

  /** 合并多条记忆为一条 */
  mergeMemories(userId: string, workspaceId: string, memoryIds: string[], mergedContent: string, mergedVector: number[], importanceScore: number, compressionLevel?: CompressionLevel): Promise<string>;

  /** 统计用户记忆数量 */
  countMemories(userId: string, workspaceId?: string): Promise<number>;

  /** 清理过期记忆 */
  deleteExpiredMemories(): Promise<number>;

  /** 获取待清理记忆（按保留分值升序） */
  getMemoriesForCleanup(userId: string, limit: number): Promise<MemoryQueryResult[]>;

  /** 获取全量记忆含向量（用于聚类压缩） */
  getAllMemoriesWithVectors(userId: string, compressionLevelFilter?: CompressionLevel): Promise<MemoryWithVector[]>;

  /** 更新访问统计 */
  updateMemoryAccessStats(userId: string, memoryIds: string[]): Promise<void>;
}

export interface InsertMemoryParams {
  userId: string;
  workspaceId: string;
  content: string;
  vector: number[];
  memoryType?: MemoryType;
  expiresAt?: number;
  importanceScore?: number;
  compressionLevel?: CompressionLevel;
  memoryCategory?: string;
}

export interface SearchParams {
  userId: string;
  workspaceId: string;
  queryVector: number[];
  topK: number;
}
