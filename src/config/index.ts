import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // 服务配置
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // JWT 配置
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    expiresIn: '7d',
  },

  // Redis 配置（用于 Working Memory 持久化，可选）
  redis: process.env.REDIS_URL ? {
    url: process.env.REDIS_URL,
  } : undefined,

  // Milvus 配置
  milvus: {
    address: process.env.MILVUS_ADDRESS || 'localhost:19530',
    token: process.env.MILVUS_TOKEN || 'root:Milvus',
    collectionName: 'user_memories',
    dimension: 384,
  },

  // LLM API 配置（私有模型，OpenAI 兼容）
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || 'http://localhost:8000/v1',
    model: process.env.LLM_MODEL || 'gpt-4',
    embeddingModel: process.env.LLM_EMBEDDING_MODEL || 'text-embedding-ada-002',
  },

  // Chunking 配置
  chunking: {
    maxTokensPerChunk: parseInt(process.env.CHUNK_MAX_TOKENS || '400', 10),
    overlapTokens: parseInt(process.env.CHUNK_OVERLAP_TOKENS || '80', 10),
  },

  // 记忆管理配置
  memory: {
    maxMemoriesPerUser: parseInt(process.env.MAX_MEMORIES_PER_USER || '1000', 10),
    cleanupThreshold: parseFloat(process.env.MEMORY_CLEANUP_THRESHOLD || '0.9'),
    cleanupTarget: parseFloat(process.env.MEMORY_CLEANUP_TARGET || '0.7'),
    cleanupBatchSize: parseInt(process.env.MEMORY_CLEANUP_BATCH || '50', 10),
    // 写入时相似记忆检索配置
    similarityTopK: parseInt(process.env.MEMORY_SIMILARITY_TOP_K || '8', 10),
    similarityThreshold: parseFloat(process.env.MEMORY_SIMILARITY_THRESHOLD || '0.7'),
  },

  // 记忆压缩配置
  compression: {
    enabled: process.env.MEMORY_COMPRESSION_ENABLED !== 'false',
    triggerRatio: parseFloat(process.env.MEMORY_COMPRESSION_TRIGGER_RATIO || '0.5'),
    clusterSimilarityThreshold: parseFloat(process.env.MEMORY_CLUSTER_THRESHOLD || '0.5'),
    minClusterSize: parseInt(process.env.MEMORY_CLUSTER_MIN_SIZE || '3', 10),
    scheduledHour: parseInt(process.env.MEMORY_COMPRESSION_HOUR || '3', 10),
  },

  // 【新增】工作记忆（会话级短期记忆）配置
  workingMemory: {
    // 每个会话保留的最大消息轮数（user+assistant 各算一条）
    maxMessages: parseInt(process.env.WORKING_MEMORY_MAX_MESSAGES || '20', 10),
    // 会话超过此时长（分钟）不活跃则自动过期
    sessionTtlMinutes: parseInt(process.env.WORKING_MEMORY_TTL_MINUTES || '120', 10),
    // 是否启用 working memory
    enabled: process.env.WORKING_MEMORY_ENABLED !== 'false',
  },

  // 【新增】嵌入向量缓存配置
  embeddingCache: {
    enabled: process.env.EMBEDDING_CACHE_ENABLED !== 'false',
    // LRU 缓存最大条数
    maxSize: parseInt(process.env.EMBEDDING_CACHE_MAX_SIZE || '2000', 10),
  },

  // 【新增】混合检索权重配置
  retrieval: {
    vectorWeight: parseFloat(process.env.RETRIEVAL_VECTOR_WEIGHT || '0.50'),
    keywordWeight: parseFloat(process.env.RETRIEVAL_KEYWORD_WEIGHT || '0.20'),
    timeDecayWeight: parseFloat(process.env.RETRIEVAL_TIME_DECAY_WEIGHT || '0.15'),
    importanceWeight: parseFloat(process.env.RETRIEVAL_IMPORTANCE_WEIGHT || '0.15'),
    halfLifeDays: parseFloat(process.env.RETRIEVAL_HALF_LIFE_DAYS || '90'),
    candidateMultiplier: parseInt(process.env.RETRIEVAL_CANDIDATE_MULTIPLIER || '3', 10),
  },

  // 多租户配额管理
  quota: {
    enabled: process.env.QUOTA_ENABLED === 'true',
    defaultMaxMemoriesPerWorkspace: parseInt(process.env.QUOTA_DEFAULT_MAX_MEMORIES || '1000', 10),
    defaultRequestsPerMinute: parseInt(process.env.QUOTA_REQUESTS_PER_MINUTE || '60', 10),
    dbPath: process.env.QUOTA_DB_PATH || './data/quota.db',
  },

  // Memory Graph（知识图谱）
  graph: {
    enabled: process.env.MEMORY_GRAPH_ENABLED !== 'false',
    dbPath: process.env.MEMORY_GRAPH_DB_PATH || './data/memory-graph.db',
  },

  // 情绪追踪
  emotion: {
    enabled: process.env.EMOTION_TRACKING_ENABLED !== 'false',
    dbPath: process.env.EMOTION_DB_PATH || './data/emotion.db',
  },

  // Persona Evolution（人格进化）
  personaEvolution: {
    enabled: process.env.PERSONA_EVOLUTION_ENABLED !== 'false',
    reflectEveryNChats: parseInt(process.env.PERSONA_REFLECT_EVERY_N || '10', 10),
    dbPath: process.env.PERSONA_EVOLUTION_DB_PATH || './data/persona-evolution.db',
  },

  // MCP Server
  mcp: {
    enabled: process.env.MCP_ENABLED === 'true',
    port: parseInt(process.env.MCP_PORT || '3001', 10),
  },

  // 多模态记忆
  multimodal: {
    enabled: process.env.MULTIMODAL_ENABLED === 'true',
    maxFileSizeMB: parseInt(process.env.MULTIMODAL_MAX_FILE_SIZE_MB || '10', 10),
  },
};

// 运行时配置校验
export function validateConfig() {
  if (!config.llm.baseURL) {
    throw new Error('LLM_BASE_URL 未设置');
  }
  if (config.jwt.secret === 'your-super-secret-jwt-key' && config.nodeEnv === 'production') {
    throw new Error('生产环境必须修改 JWT_SECRET');
  }

  // 校验检索权重之和是否合理
  const totalWeight =
    config.retrieval.vectorWeight +
    config.retrieval.keywordWeight +
    config.retrieval.timeDecayWeight +
    config.retrieval.importanceWeight;
  if (Math.abs(totalWeight - 1.0) > 0.01) {
    console.warn(`[Config] 检索权重之和为 ${totalWeight.toFixed(2)}，建议调整为 1.0`);
  }
}
