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
    // 达到此比例时触发主动聚类压缩（在清理之前）
    triggerRatio: parseFloat(process.env.MEMORY_COMPRESSION_TRIGGER_RATIO || '0.5'),
    // L2 距离阈值，小于此值的记忆归为同一簇
    clusterSimilarityThreshold: parseFloat(process.env.MEMORY_CLUSTER_THRESHOLD || '0.5'),
    // 最小簇大小，达到此数量才触发压缩
    minClusterSize: parseInt(process.env.MEMORY_CLUSTER_MIN_SIZE || '3', 10),
    // 每日定时压缩的小时（0-23，UTC）
    scheduledHour: parseInt(process.env.MEMORY_COMPRESSION_HOUR || '3', 10),
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
}
