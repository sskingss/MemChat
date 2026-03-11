// 请求上下文中的用户信息
export interface UserContext {
  userId: string;
}

// 记忆类型
export type MemoryType = 'general' | 'todo';

// Milvus 记忆数据结构
export interface Memory {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  vector: number[];
  createdAt: Date;
  memoryType: MemoryType; // 记忆类型
  expiresAt: number; // 过期时间戳（毫秒），0 表示永不过期
}

// Milvus 查询结果（未反序列化的向量）
export interface MemoryQueryResult {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  score: number; // 相似度分数
  createdAt: number; // 创建时间戳
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
  summary?: string; // 可选：对重要信息的摘要
  reason?: string; // 为什么重要
  memoryType?: MemoryType; // 记忆类型：general 或 todo
  expiresAt?: number; // 过期时间戳（毫秒），0 表示永不过期
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
