import { MilvusAdapter } from './milvus.adapter';
import type { IVectorStore } from './types';

export type { IVectorStore, InsertMemoryParams, SearchParams } from './types';

/**
 * 向量存储工厂
 *
 * 当前支持 Milvus，未来可扩展 pgvector、Qdrant 等。
 * 通过环境变量 VECTOR_STORE_TYPE 切换后端。
 */
export function createVectorStore(): IVectorStore {
  const storeType = process.env.VECTOR_STORE_TYPE || 'milvus';

  switch (storeType) {
    case 'milvus':
    default:
      return new MilvusAdapter();
  }
}

export const vectorStore: IVectorStore = createVectorStore();
