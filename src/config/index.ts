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

  // Milvus 配置
  milvus: {
    address: process.env.MILVUS_ADDRESS || 'localhost:19530',
    token: process.env.MILVUS_TOKEN || 'root:Milvus',
    collectionName: 'user_memories',
    dimension: 384, // Xenova/paraphrase-multilingual-MiniLM-L12-v2 的维度
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
    // 各维度分数权重（总和应为 1.0）
    vectorWeight: parseFloat(process.env.RETRIEVAL_VECTOR_WEIGHT || '0.50'),
    keywordWeight: parseFloat(process.env.RETRIEVAL_KEYWORD_WEIGHT || '0.20'),
    timeDecayWeight: parseFloat(process.env.RETRIEVAL_TIME_DECAY_WEIGHT || '0.15'),
    importanceWeight: parseFloat(process.env.RETRIEVAL_IMPORTANCE_WEIGHT || '0.15'),
    // 时间衰减半衰期（天），超过此时间的记忆权重减半
    halfLifeDays: parseFloat(process.env.RETRIEVAL_HALF_LIFE_DAYS || '90'),
    // 检索时拉取候选池大小（topK 的倍数，用于 reranking）
    candidateMultiplier: parseInt(process.env.RETRIEVAL_CANDIDATE_MULTIPLIER || '3', 10),
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
