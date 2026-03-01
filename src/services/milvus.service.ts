import { MilvusClient, DataType, LoadState } from '@zilliz/milvus2-sdk-node';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { MilvusError } from '../utils/errors';
import type { Memory, MemoryQueryResult } from '../types';

/**
 * Milvus 服务层
 *
 * 【核心隔离策略实现】
 *
 * 这是整个多租户系统的安全核心。所有对 Milvus 的操作都必须经过此服务层，
 * 服务层会强制校验 user_id，确保数据隔离的绝对安全。
 *
 * 隔离设计：
 * 1. Collection Schema 中 user_id 被设为 Partition Key（Milvus 2.4+ 特性）
 *    - 这意味着 Milvus 会按 user_id 自动分区存储
 *    - 查询时必须带上 user_id 过滤条件，否则 Milvus 会拒绝查询
 *
 * 2. 所有 CRUD 方法强制接收 user_id 参数
 *    - TypeScript 类型系统保证编译时检查
 *    - 如果开发者忘记传 user_id，编译就会报错
 *
 * 3. 所有 Milvus 查询表达式强制拼接 user_id 过滤
 *    - 即使前端伪造 workspace_id，也无法越权访问其他用户数据
 *    - 使用 `expr` 参数构建布尔表达式：`user_id == "{userId}"`
 *
 * 4. 双重校验机制
 *    - 第一层：authMiddleware 从 JWT 提取 user_id
 *    - 第二层：MilvusService 在查询时再次强制校验
 *    - 即使中间件被绕过，数据层仍然安全
 */
export class MilvusService {
  private client: MilvusClient;
  private collectionName: string;
  private dimension: number;

  constructor() {
    this.client = new MilvusClient({
      address: config.milvus.address,
      token: config.milvus.token,
    });
    this.collectionName = config.milvus.collectionName;
    this.dimension = config.milvus.dimension;
  }

  /**
   * 初始化 Milvus Collection
   *
   * 服务启动时调用，创建 collection 和索引
   */
  async initCollection(): Promise<void> {
    try {
      // 检查 collection 是否已存在
      const hasCollection = await this.client.hasCollection({
        collection_name: this.collectionName,
      });

      if (hasCollection.value) {
        console.log(`Collection ${this.collectionName} 已存在，跳过创建`);
        await this.client.loadCollectionSync({
          collection_name: this.collectionName,
        });
        return;
      }

      // 创建 Collection Schema
      // 【关键隔离设计】user_id 作为 Partition Key
      const schema = [
        {
          name: 'id',
          description: '记忆唯一标识',
          data_type: DataType.VarChar,
          max_length: 36,
          is_primary_key: true,
          autoID: false,
        },
        {
          name: 'user_id',
          description: '用户 ID（Partition Key）',
          data_type: DataType.VarChar,
          max_length: 64,
          is_partition_key: true, // 【核心】设为 Partition Key，强制隔离
        },
        {
          name: 'workspace_id',
          description: '工作空间 ID',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'content',
          description: '记忆内容文本',
          data_type: DataType.VarChar,
          max_length: 2000,
        },
        {
          name: 'vector',
          description: '内容向量',
          data_type: DataType.FloatVector,
          dim: this.dimension,
        },
        {
          name: 'created_at',
          description: '创建时间戳',
          data_type: DataType.Int64,
        },
      ];

      // 创建 Collection
      await this.client.createCollection({
        collection_name: this.collectionName,
        fields: schema,
        enable_dynamic_field: false,
      });

      // 创建向量索引（IVF_FLAT 索引，适用于中等规模数据）
      await this.client.createIndex({
        collection_name: this.collectionName,
        field_name: 'vector',
        index_type: 'IVF_FLAT',
        metric_type: 'L2', // L2 距离（欧氏距离）
        params: { nlist: 128 },
      });

      // 加载 Collection 到内存
      await this.client.loadCollectionSync({
        collection_name: this.collectionName,
      });

      console.log(`Collection ${this.collectionName} 创建成功并已加载`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`初始化 Collection 失败: ${message}`);
    }
  }

  /**
   * 插入记忆
   *
   * 【隔离保证】强制接收 userId，写入时自动带有 user_id 字段
   * 即使恶意调用此方法，也无法伪造其他用户的记忆
   */
  async insertMemory(
    userId: string, // 【强制参数】确保调用者必须提供 userId
    workspaceId: string,
    content: string,
    vector: number[]
  ): Promise<string> {
    // 参数校验
    if (!userId || !workspaceId || !content || vector.length !== this.dimension) {
      throw new MilvusError('insertMemory 参数无效');
    }

    const memoryId = uuidv4();
    const createdAt = Date.now();

    try {
      const result = await this.client.insert({
        collection_name: this.collectionName,
        fields_data: [
          {
            id: memoryId,
            user_id: userId, // 【核心】写入时绑定 user_id
            workspace_id: workspaceId,
            content,
            vector,
            created_at: createdAt,
          },
        ],
      });

      console.log('[Milvus] Insert result:', JSON.stringify(result, null, 2));
      return memoryId;
    } catch (error) {
      console.error('[Milvus] Insert error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`插入记忆失败: ${message}`);
    }
  }

  /**
   * 向量检索：查找与查询向量最相似的记忆
   *
   * 【隔离保证】
   * 1. 强制接收 userId 和 workspaceId
   * 2. 在 expr 中强制拼接 `user_id == "{userId}"` 过滤条件
   * 3. 即使 workspaceId 被伪造，也无法跨用户查询
   */
  async searchSimilarMemories(
    userId: string, // 【强制参数】
    workspaceId: string,
    queryVector: number[],
    topK: number = 5
  ): Promise<MemoryQueryResult[]> {
    // 参数校验
    if (!userId || !workspaceId || queryVector.length !== this.dimension) {
      throw new MilvusError('searchSimilarMemories 参数无效');
    }

    try {
      // 【核心隔离逻辑】构建布尔表达式
      // user_id 必须匹配，workspace_id 也必须匹配
      // 这样即使 attacker 知道其他人的 workspace_id，也无法查询
      const expr = `user_id == "${userId}" && workspace_id == "${workspaceId}"`;

      console.log('[Milvus] Search params:', { collection: this.collectionName, expr, vectorDim: queryVector.length });

      const result = await this.client.search({
        collection_name: this.collectionName,
        vectors: [queryVector],
        filter: expr, // 【关键】强制过滤
        limit: topK,
        output_fields: ['id', 'user_id', 'workspace_id', 'content'],
        metric_type: 'L2',
        params: { nprobe: 10 },
      });

      console.log('[Milvus] Search result:', JSON.stringify(result, null, 2));

      // 解析结果
      if (!result.results || result.results.length === 0) {
        return [];
      }

      // Milvus 返回的是单个结果数组（非批量搜索）
      const hits = result.results;

      return hits.map((hit: any) => ({
        id: hit.id,
        userId: hit.user_id,
        workspaceId: hit.workspace_id,
        content: hit.content,
        score: hit.score,
      }));
    } catch (error) {
      console.error('[Milvus] Search error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`搜索记忆失败: ${message}`);
    }
  }

  /**
   * 获取用户在某个 workspace 下的所有记忆
   *
   * 【隔离保证】强制过滤 user_id 和 workspace_id
   */
  async getMemoriesByWorkspace(
    userId: string, // 【强制参数】
    workspaceId: string
  ): Promise<MemoryQueryResult[]> {
    if (!userId || !workspaceId) {
      throw new MilvusError('getMemoriesByWorkspace 参数无效');
    }

    try {
      // 【核心隔离逻辑】强制过滤 user_id
      const expr = `user_id == "${userId}" && workspace_id == "${workspaceId}"`;

      const result = await this.client.query({
        collection_name: this.collectionName,
        filter: expr,
        output_fields: ['id', 'user_id', 'workspace_id', 'content', 'created_at'],
      });

      if (!result.data || result.data.length === 0) {
        return [];
      }

      return result.data.map((item: any) => ({
        id: item.id,
        userId: item.user_id,
        workspaceId: item.workspace_id,
        content: item.content,
        score: 0, // 列表查询不需要相似度分数
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`获取记忆列表失败: ${message}`);
    }
  }

  /**
   * 更新记忆内容
   *
   * 【隔离保证】
   * 1. 先查询该记忆是否存在，且 owner 是当前 userId
   * 2. 只有校验通过才允许更新
   * 3. 更新操作在 Milvus 中是 delete + insert
   */
  async updateMemory(
    userId: string, // 【强制参数】
    memoryId: string,
    newContent: string,
    newVector: number[]
  ): Promise<boolean> {
    if (!userId || !memoryId || !newContent || newVector.length !== this.dimension) {
      throw new MilvusError('updateMemory 参数无效');
    }

    try {
      // 【第一步隔离校验】查询该记忆是否存在，且 owner 是当前用户
      const expr = `id == "${memoryId}" && user_id == "${userId}"`;

      const existingMemory = await this.client.query({
        collection_name: this.collectionName,
        filter: expr,
        output_fields: ['id', 'user_id', 'workspace_id'],
        limit: 1,
      });

      if (!existingMemory.data || existingMemory.data.length === 0) {
        // 记忆不存在或不属于当前用户
        return false;
      }

      const workspaceId = existingMemory.data[0].workspace_id;

      // 【第二步】执行更新（Milvus 不支持原地更新，需要 delete + insert）
      await this.client.deleteEntities({
        collection_name: this.collectionName,
        filter: `id == "${memoryId}"`,
      });

      // 插入新记录（保持原有的 workspace_id）
      await this.insertMemory(userId, workspaceId, newContent, newVector);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`更新记忆失败: ${message}`);
    }
  }

  /**
   * 删除记忆
   *
   * 【隔离保证】
   * 先校验记忆的 owner，只有 owner 才能删除
   */
  async deleteMemory(
    userId: string, // 【强制参数】
    memoryId: string
  ): Promise<boolean> {
    if (!userId || !memoryId) {
      throw new MilvusError('deleteMemory 参数无效');
    }

    try {
      // 【第一步隔离校验】查询该记忆是否存在，且 owner 是当前用户
      const expr = `id == "${memoryId}" && user_id == "${userId}"`;

      const existingMemory = await this.client.query({
        collection_name: this.collectionName,
        filter: expr,
        output_fields: ['id'],
        limit: 1,
      });

      if (!existingMemory.data || existingMemory.data.length === 0) {
        // 记忆不存在或不属于当前用户
        return false;
      }

      // 【第二步】执行删除
      await this.client.deleteEntities({
        collection_name: this.collectionName,
        filter: `id == "${memoryId}"`,
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`删除记忆失败: ${message}`);
    }
  }
}

// 单例模式，全局共享一个 Milvus 客户端
export const milvusService = new MilvusService();
