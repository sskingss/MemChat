import { pipeline, env } from '@xenova/transformers';
import { EmbeddingError } from '../utils/errors';
import { config } from '../config';

// 禁用远程下载模型的警告（仅在本地使用）
env.allowLocalModels = false;
env.useBrowserCache = false;

/**
 * 简单 LRU 缓存
 *
 * 基于 Map 的插入顺序特性实现 LRU：
 * - get 时将条目移动到末尾（最近使用）
 * - 达到上限时删除头部条目（最久未使用）
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const val = this.cache.get(key)!;
    // 移到末尾（标记为最近使用）
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最久未使用的条目（Map 头部）
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Embedding 服务
 *
 * 使用本地 Xenova/paraphrase-multilingual-MiniLM-L12-v2 模型
 * 支持多语言，维度 384，无需外部 API
 *
 * 【性能优化】内置 LRU 嵌入缓存：
 * - 相同文本只计算一次向量
 * - 显著降低 chat → processAndStoreMemory 的重复计算
 * - 可通过 EMBEDDING_CACHE_ENABLED=false 关闭
 */
export class EmbeddingService {
  private embeddingModel: any = null;
  private readonly embeddingDimension: number = 384;

  // LRU 缓存：text → vector
  private readonly cache: LRUCache<string, number[]>;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor() {
    const maxSize = config.embeddingCache.maxSize;
    this.cache = new LRUCache<string, number[]>(maxSize);
    if (config.embeddingCache.enabled) {
      console.log(`[Embedding] 缓存已启用，最大条数: ${maxSize}`);
    }
  }

  /**
   * 初始化模型
   */
  async init() {
    if (this.embeddingModel) {
      return;
    }

    try {
      console.log('[Embedding] 正在加载本地模型...');
      this.embeddingModel = await pipeline(
        'feature-extraction',
        'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        {
          quantized: true, // 使用量化模型，更小更快
        }
      );
      console.log('[Embedding] 模型加载完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`模型加载失败: ${message}`);
    }
  }

  /**
   * 生成文本向量（带缓存）
   *
   * 相同文本直接返回缓存结果，避免重复推理
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // 缓存命中
    if (config.embeddingCache.enabled) {
      const cached = this.cache.get(text);
      if (cached) {
        this.cacheHits++;
        return cached;
      }
      this.cacheMisses++;
    }

    try {
      await this.init();

      const output = await this.embeddingModel(text, {
        pooling: 'mean',
        normalize: true,
      });

      const embedding = Array.from(output.data) as number[];

      // 写入缓存
      if (config.embeddingCache.enabled) {
        this.cache.set(text, embedding);
      }

      return embedding;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`生成向量失败: ${message}`);
    }
  }

  /**
   * 批量生成向量（带缓存）
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      await this.init();

      const results: number[][] = [];
      for (const text of texts) {
        const embedding = await this.generateEmbedding(text);
        results.push(embedding);
      }
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`批量生成向量失败: ${message}`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { hits: number; misses: number; size: number; hitRate: string } {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? ((this.cacheHits / total) * 100).toFixed(1) + '%' : 'N/A';
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.cache.size,
      hitRate,
    };
  }

  /**
   * 获取向量维度
   */
  getDimension(): number {
    return this.embeddingDimension;
  }
}

export const embeddingService = new EmbeddingService();
