// 请求上下文中的用户信息
export interface UserContext {
  userId: string;
}

// 记忆类型
export type MemoryType = 'general' | 'todo';

// 记忆压缩层级：0=原始片段, 1=话题摘要, 2=高层概括
export type CompressionLevel = 0 | 1 | 2;

// Milvus 记忆数据结构
export interface Memory {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  vector: number[];
  createdAt: Date;
  memoryType: MemoryType;
  expiresAt: number; // 过期时间戳（毫秒），0 表示永不过期
  // 智能压缩相关字段（动态字段）
  importanceScore: number; // 重要性分值 1-10，默认 5
  accessCount: number; // RAG 检索命中次数
  lastAccessedAt: number; // 最后一次被检索的时间戳（毫秒）
  compressionLevel: CompressionLevel; // 压缩层级
}

// Milvus 查询结果（未反序列化的向量）
export interface MemoryQueryResult {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  score: number; // 相似度分数
  createdAt: number; // 创建时间戳
  // 智能压缩相关字段
  importanceScore: number;
  accessCount: number;
  lastAccessedAt: number;
  compressionLevel: CompressionLevel;
}

// 用于压缩服务的完整记忆数据（包含向量）
export interface MemoryWithVector extends MemoryQueryResult {
  vector: number[];
}

// Chat 请求体
export interface ChatRequest {
  workspaceId: string;
  message: string;
}

// Chat 响应体
export interface ChatResponse {
  response: string;
  memoriesUsed: number; // 本次 RAG 用到的记忆条数
  memoriesStored: number; // 本次新存入的记忆条数
}

// 记忆重要性判断结果
export interface MemoryImportanceResult {
  isImportant: boolean;
  summary?: string;
  reason?: string;
  memoryType?: MemoryType;
  expiresAt?: number; // 过期时间戳（毫秒），0 表示永不过期
  importanceScore?: number; // 重要性分值 1-10
}

// 相似记忆上下文（用于 LLM 判断）
export interface SimilarMemoryContext {
  id: string;
  content: string;
  score: number;
}

// 记忆更新决策结果
export interface MemoryUpdateDecision {
  action: 'create' | 'update' | 'merge';
  reason: string;
  targetMemoryId?: string;      // action = 'update' 时
  targetMemoryIds?: string[];   // action = 'merge' 时
  updatedContent?: string;      // action = 'update' 时
  mergedContent?: string;       // action = 'merge' 时
  newContent?: string;          // action = 'create' 时
}

// 记忆更新执行结果
export interface MemoryUpdateResult {
  action: 'created' | 'updated' | 'merged' | 'skipped';
  memoryIds: string[];
  reason: string;
}

// Milvus 集合 Schema
export interface MilvusCollectionSchema {
  name: string;
  dimension: number;
}

// 人格系统类型导出
export * from './persona';
