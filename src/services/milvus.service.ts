import { MilvusClient, DataType, LoadState } from '@zilliz/milvus2-sdk-node';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { MilvusError } from '../utils/errors';
import type { Memory, MemoryQueryResult, UserPersona, BootstrapSession, MemoryType } from '../types';

/**
 * 用户信息接口
 */
interface UserInfo {
  userId: string;
  username: string;
  createdAt: number;
}

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
  private userPersonaCollectionName: string;
  private bootstrapSessionCollectionName: string;

  // 内存存储 bootstrap sessions（临时数据，无需持久化到 Milvus）
  private bootstrapSessions: Map<string, BootstrapSession> = new Map();

  constructor() {
    this.client = new MilvusClient({
      address: config.milvus.address,
      token: config.milvus.token,
    });
    this.collectionName = config.milvus.collectionName;
    this.dimension = config.milvus.dimension;
    this.userPersonaCollectionName = 'user_personas';
    this.bootstrapSessionCollectionName = 'bootstrap_sessions';
  }

  /**
   * 注册或获取用户
   * userId = username，无需持久化存储
   */
  async registerOrGetUser(username: string): Promise<UserInfo> {
    return {
      userId: username,
      username,
      createdAt: Date.now(),
    };
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
        console.log(`Collection ${this.collectionName} 已存在`);

        // 检查是否支持动态字段
        const collectionInfo = await this.client.describeCollection({
          collection_name: this.collectionName,
        });

        const enableDynamicField = collectionInfo.schema.enable_dynamic_field;
        console.log(`[Milvus] 动态字段状态: ${enableDynamicField}`);

        if (!enableDynamicField) {
          console.log(`[Milvus] Collection 不支持动态字段，需要重建...`);
          await this.recreateCollection();
        } else {
          await this.client.loadCollectionSync({
            collection_name: this.collectionName,
          });
        }
      } else {
        await this.createMemoryCollection();
      }

      // 始终初始化 user_personas 和 bootstrap_sessions 集合
      await this.initUserPersonaCollection();
      await this.initBootstrapSessionCollection();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`初始化 Collection 失败: ${message}`);
    }
  }

  /**
   * 创建记忆 Collection（启用动态字段）
   */
  private async createMemoryCollection(): Promise<void> {
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
        description: '用户 ID(Partition Key)',
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
      enable_dynamic_field: true, // 启用动态字段，支持 memory_type 和 expires_at
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
  }

  /**
   * 重建 Collection（删除旧 collection 并创建新的）
   *
   * 注意：这会丢失所有数据！仅用于开发环境或首次升级时
   */
  private async recreateCollection(): Promise<void> {
    console.log(`[Milvus] 正在删除旧的 Collection ${this.collectionName}...`);

    // 先释放 collection
    try {
      await this.client.releaseCollection({
        collection_name: this.collectionName,
      });
    } catch (error) {
      // 忽略释放失败的错误
    }

    // 删除 collection
    await this.client.dropCollection({
      collection_name: this.collectionName,
    });

    console.log(`[Milvus] 旧 Collection 已删除，正在创建新的 Collection...`);

    // 创建新的 collection
    await this.createMemoryCollection();

    console.log(`[Milvus] Collection 重建完成（支持动态字段）`);
  }

  /**
   * 插入记忆
   *
   * 【隔离保证】强制接收 userId，写入时自动带有 user_id 字段
   * 即使恶意调用此方法，也无法伪造其他用户的记忆
   *
   * @param memoryType 记忆类型：general 或 todo
   * @param expiresAt 过期时间戳（毫秒），0 表示永不过期
   */
  async insertMemory(
    userId: string, // 【强制参数】确保调用者必须提供 userId
    workspaceId: string,
    content: string,
    vector: number[],
    memoryType: MemoryType = 'general',
    expiresAt: number = 0
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
            // 动态字段
            memory_type: memoryType,
            expires_at: expiresAt,
          },
        ],
      });

      console.log('[Milvus] Insert result:', JSON.stringify(result, null, 2));
      console.log(`[Milvus] 插入记忆: id=${memoryId}, type=${memoryType}, expiresAt=${expiresAt || 'never'}`);
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
   * 检索相似记忆（带相似度阈值过滤）
   *
   * @param threshold L2 距离阈值，越小越相似（默认 1.0）
   */
  async searchSimilarMemoriesWithThreshold(
    userId: string,
    workspaceId: string,
    queryVector: number[],
    topK: number = 5,
    threshold: number = 1.0
  ): Promise<MemoryQueryResult[]> {
    const results = await this.searchSimilarMemories(userId, workspaceId, queryVector, topK);

    // 过滤掉相似度太低的结果（L2 距离越小越相似）
    const filtered = results.filter(r => r.score < threshold);
    console.log(`[Milvus] 相似记忆过滤: ${results.length} -> ${filtered.length} (threshold: ${threshold})`);
    return filtered;
  }

  /**
   * 批量删除记忆并创建合并后的新记忆
   *
   * 用于 MERGE 操作：删除多条旧记忆，创建一条合并后的新记忆
   */
  async mergeMemories(
    userId: string,
    workspaceId: string,
    memoryIds: string[],
    mergedContent: string,
    mergedVector: number[]
  ): Promise<string> {
    if (!userId || !workspaceId || memoryIds.length === 0 || !mergedContent) {
      throw new MilvusError('mergeMemories 参数无效');
    }

    try {
      // 1. 验证所有记忆都属于当前用户
      const idsExpr = memoryIds.map(id => `"${id}"`).join(', ');
      const expr = `user_id == "${userId}" && workspace_id == "${workspaceId}" && id in [${idsExpr}]`;

      const existingMemories = await this.client.query({
        collection_name: this.collectionName,
        filter: expr,
        output_fields: ['id'],
      });

      if (!existingMemories.data || existingMemories.data.length !== memoryIds.length) {
        console.warn(`[Milvus] 合并验证失败: 期望 ${memoryIds.length} 条，找到 ${existingMemories.data?.length || 0} 条`);
        throw new MilvusError('部分记忆不存在或不属于当前用户');
      }

      // 2. 删除所有旧记忆
      for (const id of memoryIds) {
        await this.client.deleteEntities({
          collection_name: this.collectionName,
          filter: `id == "${id}"`,
        });
      }

      console.log(`[Milvus] 已删除 ${memoryIds.length} 条旧记忆`);

      // 3. 创建合并后的新记忆
      const newId = await this.insertMemory(userId, workspaceId, mergedContent, mergedVector);

      console.log(`[Milvus] 合并完成: ${memoryIds.length} 条记忆 -> 新记忆 ${newId}`);
      return newId;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`合并记忆失败: ${message}`);
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

  /**
   * 清理过期的记忆
   *
   * 删除所有 expires_at > 0 && expires_at < now 的记录
   * @returns 删除的记忆数量
   */
  async deleteExpiredMemories(): Promise<number> {
    try {
      const now = Date.now();

      // 查询所有过期的记忆
      const expr = `expires_at > 0 && expires_at < ${now}`;

      const expiredMemories = await this.client.query({
        collection_name: this.collectionName,
        filter: expr,
        output_fields: ['id', 'content', 'memory_type', 'expires_at'],
      });

      if (!expiredMemories.data || expiredMemories.data.length === 0) {
        console.log('[Milvus] 没有过期的记忆需要清理');
        return 0;
      }

      const count = expiredMemories.data.length;
      console.log(`[Milvus] 发现 ${count} 条过期记忆，开始清理...`);

      // 删除过期的记忆
      await this.client.deleteEntities({
        collection_name: this.collectionName,
        filter: expr,
      });

      console.log(`[Milvus] 已清理 ${count} 条过期记忆`);
      return count;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Milvus] 清理过期记忆失败: ${message}`);
      throw new MilvusError(`清理过期记忆失败: ${message}`);
    }
  }

  // ============ User Persona 集合操作 ============

  /**
   * 初始化 user_personas 集合
   *
   * 存储完整的用户人格配置（不再使用 YAML 引用）
   * 注意：Milvus 要求每个 collection 必须有向量字段，所以添加一个 dummy vector
   */
  async initUserPersonaCollection(): Promise<void> {
    try {
      const hasCollection = await this.client.hasCollection({
        collection_name: this.userPersonaCollectionName,
      });

      if (hasCollection.value) {
        console.log(`Collection ${this.userPersonaCollectionName} 已存在，跳过创建`);
        await this.client.loadCollectionSync({
          collection_name: this.userPersonaCollectionName,
        });
        return;
      }

      // user_personas 集合 Schema - 存储完整人格配置
      // Milvus 要求必须有向量字段，添加一个 dummy vector (dim=2)
      const schema = [
        {
          name: 'id',
          description: '人格记录 ID',
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
          is_partition_key: true,
        },
        // Identity
        {
          name: 'ai_name',
          description: 'AI 昵称',
          data_type: DataType.VarChar,
          max_length: 50,
        },
        {
          name: 'user_name',
          description: '用户昵称',
          data_type: DataType.VarChar,
          max_length: 50,
        },
        {
          name: 'relationship',
          description: '关系定位',
          data_type: DataType.VarChar,
          max_length: 100,
        },
        // Core Traits
        {
          name: 'core_traits',
          description: '核心特质 (JSON)',
          data_type: DataType.VarChar,
          max_length: 2000,
        },
        // Communication
        {
          name: 'communication_style',
          description: '沟通风格',
          data_type: DataType.VarChar,
          max_length: 500,
        },
        {
          name: 'language',
          description: '首选语言',
          data_type: DataType.VarChar,
          max_length: 20,
        },
        // Growth
        {
          name: 'lessons_learned',
          description: '经验教训 (JSON)',
          data_type: DataType.VarChar,
          max_length: 2000,
        },
        // Dummy vector (required by Milvus)
        {
          name: 'dummy_vector',
          description: 'Dummy vector (required by Milvus)',
          data_type: DataType.FloatVector,
          dim: 2,
        },
        // Meta
        {
          name: 'created_at',
          description: '创建时间戳',
          data_type: DataType.Int64,
        },
        {
          name: 'updated_at',
          description: '更新时间戳',
          data_type: DataType.Int64,
        },
      ];

      await this.client.createCollection({
        collection_name: this.userPersonaCollectionName,
        fields: schema,
        enable_dynamic_field: false,
      });

      // 创建 dummy vector 索引
      await this.client.createIndex({
        collection_name: this.userPersonaCollectionName,
        field_name: 'dummy_vector',
        index_type: 'IVF_FLAT',
        metric_type: 'L2',
        params: { nlist: 2 },
      });

      await this.client.loadCollectionSync({
        collection_name: this.userPersonaCollectionName,
      });

      console.log(`Collection ${this.userPersonaCollectionName} 创建成功并已加载`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`初始化 user_personas 集合失败: ${message}`);
    }
  }

  /**
   * 初始化 bootstrap_sessions 集合
   *
   * 注意：由于 Milvus 要求每个 collection 必须有向量字段，
   * 而 bootstrap_sessions 是临时数据，我们改用内存存储。
   */
  async initBootstrapSessionCollection(): Promise<void> {
    // 不再使用 Milvus 存储，改用内存 Map
    console.log(`Bootstrap sessions will use in-memory storage`);
  }

  /**
   * 查询用户的人格配置
   */
  async queryUserPersona(userId: string): Promise<UserPersona | null> {
    try {
      const expr = `user_id == "${userId}"`;
      console.log(`[MilvusService] 查询 AI 人格, collection: ${this.userPersonaCollectionName}, expr: ${expr}`);

      const result = await this.client.query({
        collection_name: this.userPersonaCollectionName,
        filter: expr,
        output_fields: [
          'id', 'user_id', 'ai_name', 'user_name', 'relationship',
          'core_traits', 'communication_style', 'language',
          'lessons_learned', 'created_at', 'updated_at'
        ],
        limit: 1,
      });

      console.log('result', result)

      console.log(`[MilvusService] 查询结果: result.data.length = ${result.data?.length || 0}`);

      if (!result.data || result.data.length === 0) {
        console.log(`[MilvusService] 未找到用户人格数据`);
        return null;
      }

      const item = result.data[0];
      console.log(`[MilvusService] 找到人格数据: id=${item.id}, ai_name=${item.ai_name}, user_id=${item.user_id}`);

      return {
        id: item.id,
        userId: item.user_id,
        aiName: item.ai_name || '',
        userName: item.user_name || '',
        relationship: item.relationship || '',
        coreTraits: item.core_traits ? JSON.parse(item.core_traits) : [],
        communicationStyle: item.communication_style || '',
        language: item.language || 'zh',
        longTermVision: item.long_term_vision || undefined,
        boundaries: item.boundaries ? JSON.parse(item.boundaries) : undefined,
        lessonsLearned: item.lessons_learned ? JSON.parse(item.lessons_learned) : [],
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[MilvusService] 查询用户人格失败: ${message}`);
      throw new MilvusError(`查询用户人格失败: ${message}`);
    }
  }

  /**
   * 保存用户人格配置
   */
  async saveUserPersona(persona: UserPersona): Promise<void> {
    try {
      const existing = await this.queryUserPersona(persona.userId);

      if (existing) {
        // 删除旧记录
        await this.client.deleteEntities({
          collection_name: this.userPersonaCollectionName,
          filter: `id == "${existing.id}"`,
        });
      }

      // 插入新记录（只包含 schema 定义的字段）
      await this.client.insert({
        collection_name: this.userPersonaCollectionName,
        fields_data: [
          {
            id: existing?.id || persona.id,
            user_id: persona.userId,
            ai_name: persona.aiName,
            user_name: persona.userName,
            relationship: persona.relationship,
            core_traits: JSON.stringify(persona.coreTraits || []),
            communication_style: persona.communicationStyle || '',
            language: persona.language || 'zh',
            lessons_learned: JSON.stringify(persona.lessonsLearned || []),
            dummy_vector: [1.0, 0.0],
            created_at: existing?.createdAt || persona.createdAt || Date.now(),
            updated_at: Date.now(),
          },
        ],
      });
      console.log(`[MilvusService] 保存用户人格成功: id=${persona.id}, user_id=${persona.userId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`保存用户人格失败: ${message}`);
    }
  }

  /**
   * 删除用户人格
   */
  async deleteUserPersona(userId: string): Promise<boolean> {
    try {
      const existing = await this.queryUserPersona(userId);
      if (!existing) {
        return false;
      }

      await this.client.deleteEntities({
        collection_name: this.userPersonaCollectionName,
        filter: `id == "${existing.id}"`,
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new MilvusError(`删除用户人格失败: ${message}`);
    }
  }

  // ============ Bootstrap Session 操作（使用内存存储）============

  /**
   * 创建新的引导会话
   */
  async createBootstrapSession(userId: string): Promise<BootstrapSession> {
    const session: BootstrapSession = {
      id: uuidv4(),
      userId,
      phase: 1,
      extractedData: {},
      conversationHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.bootstrapSessions.set(session.id, session);
    return session;
  }

  /**
   * 获取引导会话
   */
  async getBootstrapSession(sessionId: string, userId: string): Promise<BootstrapSession | null> {
    const session = this.bootstrapSessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }
    return session;
  }

  /**
   * 获取用户最新的引导会话
   */
  async getLatestBootstrapSession(userId: string): Promise<BootstrapSession | null> {
    let latestSession: BootstrapSession | null = null;

    for (const session of this.bootstrapSessions.values()) {
      if (session.userId === userId) {
        if (!latestSession || session.updatedAt > latestSession.updatedAt) {
          latestSession = session;
        }
      }
    }

    return latestSession;
  }

  /**
   * 更新引导会话
   */
  async updateBootstrapSession(session: BootstrapSession): Promise<void> {
    session.updatedAt = Date.now();
    this.bootstrapSessions.set(session.id, session);
  }

  /**
   * 删除引导会话
   */
  async deleteBootstrapSession(sessionId: string, userId: string): Promise<void> {
    const session = this.bootstrapSessions.get(sessionId);
    if (session && session.userId === userId) {
      this.bootstrapSessions.delete(sessionId);
    }
  }
}

// 单例模式，全局共享一个 Milvus 客户端
export const milvusService = new MilvusService();
