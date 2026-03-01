import { pipeline, env } from '@xenova/transformers';
import { EmbeddingError } from '../utils/errors';
import { config } from '../config';

// 禁用远程下载模型的警告（仅在本地使用）
env.allowLocalModels = false;
env.useBrowserCache = false;

/**
 * Embedding 服务
 *
 * 使用本地 Xenova/paraphrase-multilingual-MiniLM-L12-v2 模型
 * 支持多语言，维度 384，无需外部 API
 */
export class EmbeddingService {
  private embeddingModel: any = null;
  private embeddingDimension: number = 384; // paraphrase-multilingual-MiniLM-L12-v2 的维度

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
   * 生成文本向量
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      await this.init();

      const output = await this.embeddingModel(text, {
        pooling: 'mean',
        normalize: true,
      });

      // 转换为数组
      const embedding = Array.from(output.data);
      return embedding;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`生成向量失败: ${message}`);
    }
  }

  /**
   * 批量生成向量
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      await this.init();

      const results: number[][] = [];
      for (const text of texts) {
        const output = await this.embeddingModel(text, {
          pooling: 'mean',
          normalize: true,
        });
        results.push(Array.from(output.data));
      }
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`批量生成向量失败: ${message}`);
    }
  }

  /**
   * 获取向量维度
   */
  getDimension(): number {
    return this.embeddingDimension;
  }
}

export const embeddingService = new EmbeddingService();
