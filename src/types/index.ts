// 请求上下文中的用户信息
export interface UserContext {
  userId: string;
}

// Milvus 记忆数据结构
export interface Memory {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  vector: number[];
  createdAt: Date;
}

// Milvus 查询结果（未反序列化的向量）
export interface MemoryQueryResult {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  score: number; // 相似度分数
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
}

// Milvus 集合 Schema
export interface MilvusCollectionSchema {
  name: string;
  dimension: number;
}
