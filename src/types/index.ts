// 请求上下文中的用户信息
export interface UserContext {
  userId: string;
}

// 记忆类型（向后兼容）
export type MemoryType = 'general' | 'todo';

// 记忆认知分类（新增，对应认知科学的记忆模型）
// - semantic:   语义记忆，关于用户的稳定事实（偏好、背景、技能、价值观）
// - episodic:   情节记忆，发生过的具体事件（会议、经历、决策）
// - procedural: 程序记忆，行为习惯与模式（如何做事的方式）
// - todo:       任务记忆，待办事项与截止日期
export type MemoryCategory = 'semantic' | 'episodic' | 'procedural' | 'todo';

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
  memoryCategory?: MemoryCategory; // 新增：认知分类
  expiresAt: number; // 过期时间戳（毫秒），0 表示永不过期
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
  score: number; // 相似度分数（L2距离，越小越相似）
  createdAt: number; // 创建时间戳
  memoryCategory?: MemoryCategory; // 认知分类
  importanceScore: number;
  accessCount: number;
  lastAccessedAt: number;
  compressionLevel: CompressionLevel;
}

// 用于压缩服务的完整记忆数据（包含向量）
export interface MemoryWithVector extends MemoryQueryResult {
  vector: number[];
}

// ============ Working Memory（会话级短期记忆）============

// 单条会话消息
export interface WorkingMemoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// 会话级工作记忆（存储最近 N 轮对话）
export interface WorkingMemorySession {
  sessionId: string;
  userId: string;
  workspaceId: string;
  messages: WorkingMemoryMessage[];
  createdAt: number;
  updatedAt: number;
}

// ============ 记忆处理 Pipeline（新：单次 LLM 调用）============

// Pipeline 提取的单条事实
export interface MemoryPipelineFact {
  content: string;           // 事实摘要
  category: MemoryCategory;  // 认知分类
  importanceScore: number;   // 重要性分值 1-10
  expiresAt: number;         // 过期时间戳，0 表示永不过期
  action: 'create' | 'update' | 'merge' | 'skip';
  targetMemoryId?: string | null;   // action=update 时
  targetMemoryIds?: string[] | null; // action=merge 时
  actionContent?: string | null;    // update/merge/create 时的实际存储内容
}

// Pipeline 完整结果
export interface MemoryPipelineResult {
  facts: MemoryPipelineFact[];
}

// Chat 请求体
export interface ChatRequest {
  workspaceId: string;
  message: string;
  sessionId?: string; // 可选，会话 ID（用于 working memory）
}

// Chat 响应体
export interface ChatResponse {
  response: string;
  memoriesUsed: number; // 本次 RAG 用到的记忆条数
  memoriesStored: number; // 本次新存入的记忆条数
  sessionId: string; // 返回当前会话 ID
}

// ============ 兼容旧接口（保留供内部使用）============

// 记忆重要性判断结果（旧版，保留向后兼容）
export interface MemoryImportanceResult {
  isImportant: boolean;
  summary?: string;
  reason?: string;
  memoryType?: MemoryType;
  expiresAt?: number;
  importanceScore?: number;
}

// 相似记忆上下文（用于 LLM 判断）
export interface SimilarMemoryContext {
  id: string;
  content: string;
  score: number;
}

// 记忆更新决策结果（旧版，保留向后兼容）
export interface MemoryUpdateDecision {
  action: 'create' | 'update' | 'merge';
  reason: string;
  targetMemoryId?: string;
  targetMemoryIds?: string[];
  updatedContent?: string;
  mergedContent?: string;
  newContent?: string;
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
