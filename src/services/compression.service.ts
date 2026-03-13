import { milvusService } from './milvus.service';
import { embeddingService } from './embedding.service';
import { llmService } from './llm.service';
import { config } from '../config';
import type { MemoryWithVector, CompressionLevel } from '../types';

/**
 * 记忆聚类压缩服务
 *
 * 职责：
 * 1. 对用户全量记忆向量进行贪心聚类
 * 2. 对每个满足最小大小要求的簇调用 LLM 生成摘要
 * 3. 用摘要替换簇内所有原始记忆（分层压缩：level 0→1, level 1→2）
 */
export class CompressionService {
  private runningUsers = new Set<string>(); // 防止同一用户并发触发

  /**
   * 对指定用户的记忆执行一轮聚类压缩
   *
   * @param userId 用户 ID
   * @param targetLevel 压缩目标层级（0=压缩原始片段为摘要, 1=压缩摘要为高层概括）
   * @returns 压缩后减少的记忆条数
   */
  async compressUserMemories(userId: string, targetLevel: CompressionLevel = 0): Promise<number> {
    if (!config.compression.enabled) {
      return 0;
    }

    if (this.runningUsers.has(userId)) {
      console.log(`[Compression] 用户 ${userId} 的压缩任务正在运行，跳过`);
      return 0;
    }

    this.runningUsers.add(userId);

    try {
      const sourceLevel = targetLevel as CompressionLevel;
      const destLevel = (targetLevel + 1) as CompressionLevel;

      console.log(`[Compression] 开始压缩用户 ${userId} 的 level=${sourceLevel} 记忆...`);

      // 1. 拉取该层级的所有记忆（含向量）
      const memories = await milvusService.getAllMemoriesWithVectors(userId, sourceLevel);

      if (memories.length < config.compression.minClusterSize) {
        console.log(`[Compression] 记忆数量不足（${memories.length} < ${config.compression.minClusterSize}），跳过`);
        return 0;
      }

      // 2. 对记忆向量进行贪心聚类
      const clusters = this.greedyCluster(memories, config.compression.clusterSimilarityThreshold);

      const compressibleClusters = clusters.filter(c => c.length >= config.compression.minClusterSize);
      console.log(`[Compression] 发现 ${compressibleClusters.length} 个可压缩簇（共 ${clusters.length} 簇）`);

      if (compressibleClusters.length === 0) {
        return 0;
      }

      let totalReduced = 0;

      // 3. 逐簇进行 LLM 压缩
      for (const cluster of compressibleClusters) {
        try {
          const reduced = await this.compressCluster(userId, cluster, destLevel);
          totalReduced += reduced;
        } catch (error) {
          console.error(`[Compression] 簇压缩失败:`, error);
        }
      }

      console.log(`[Compression] 用户 ${userId} 压缩完成，净减少 ${totalReduced} 条记忆`);
      return totalReduced;
    } finally {
      this.runningUsers.delete(userId);
    }
  }

  /**
   * 检查是否需要触发压缩（记忆量超过 triggerRatio 时）
   *
   * @returns 是否执行了压缩
   */
  async checkAndCompress(userId: string): Promise<boolean> {
    if (!config.compression.enabled) {
      return false;
    }

    const { maxMemoriesPerUser } = config.memory;
    const { triggerRatio } = config.compression;
    const triggerCount = Math.floor(maxMemoriesPerUser * triggerRatio);

    const currentCount = await milvusService.countMemories(userId);

    if (currentCount < triggerCount) {
      return false;
    }

    console.log(`[Compression] 用户 ${userId} 记忆数 ${currentCount} 超过压缩触发阈值 ${triggerCount}，开始压缩`);

    // 先压缩原始片段（level 0 → 1）
    await this.compressUserMemories(userId, 0);

    // 再压缩摘要层（level 1 → 2），仅当摘要数量也超过阈值时
    const countAfterFirstPass = await milvusService.countMemories(userId);
    if (countAfterFirstPass >= triggerCount) {
      await this.compressUserMemories(userId, 1);
    }

    return true;
  }

  /**
   * 启动每日定时压缩任务
   *
   * 不使用 cron 库，通过计算距下次触发时间的毫秒数来实现。
   */
  startScheduledCompression(getUserIds: () => Promise<string[]>): void {
    if (!config.compression.enabled) {
      console.log('[Compression] 压缩服务已禁用，跳过定时任务');
      return;
    }

    const scheduleNext = () => {
      const now = new Date();
      const target = new Date(now);
      target.setUTCHours(config.compression.scheduledHour, 0, 0, 0);

      if (target <= now) {
        target.setUTCDate(target.getUTCDate() + 1);
      }

      const delay = target.getTime() - now.getTime();
      console.log(`[Compression] 下次定时全量压缩将在 ${target.toISOString()} 执行（${Math.round(delay / 60000)} 分钟后）`);

      setTimeout(async () => {
        console.log('[Compression] 开始每日全量压缩任务...');
        try {
          const userIds = await getUserIds();
          for (const uid of userIds) {
            await this.compressUserMemories(uid, 0);
          }
          console.log(`[Compression] 全量压缩完成，共处理 ${userIds.length} 个用户`);
        } catch (error) {
          console.error('[Compression] 全量压缩任务失败:', error);
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  /**
   * 贪心聚类算法
   *
   * 遍历所有记忆，对每条记忆寻找已有簇中与它 L2 距离最近的簇中心，
   * 若距离 < threshold 则加入该簇，否则新建簇。
   *
   * 时间复杂度：O(n * k)，k 为簇数，适合中小规模（≤5000条）。
   */
  private greedyCluster(memories: MemoryWithVector[], threshold: number): MemoryWithVector[][] {
    const clusters: MemoryWithVector[][] = [];
    const centroids: number[][] = [];

    for (const memory of memories) {
      if (!memory.vector || memory.vector.length === 0) continue;

      let bestClusterIdx = -1;
      let bestDist = Infinity;

      for (let i = 0; i < centroids.length; i++) {
        const dist = this.l2Distance(memory.vector, centroids[i]);
        if (dist < bestDist) {
          bestDist = dist;
          bestClusterIdx = i;
        }
      }

      if (bestClusterIdx >= 0 && bestDist < threshold) {
        clusters[bestClusterIdx].push(memory);
        // 更新簇中心为当前簇所有向量的均值
        centroids[bestClusterIdx] = this.meanVector(
          clusters[bestClusterIdx].map(m => m.vector)
        );
      } else {
        clusters.push([memory]);
        centroids.push([...memory.vector]);
      }
    }

    return clusters;
  }

  /**
   * 对单个簇执行压缩：调用 LLM 生成摘要，删除原记忆，写入压缩记忆
   *
   * @returns 净减少的记忆条数（原始数 - 1）
   */
  private async compressCluster(
    userId: string,
    cluster: MemoryWithVector[],
    destLevel: CompressionLevel
  ): Promise<number> {
    // 使用簇内记忆数量最多的 workspace（同一用户跨 workspace 不应合并）
    const workspaceGroups = new Map<string, MemoryWithVector[]>();
    for (const m of cluster) {
      const arr = workspaceGroups.get(m.workspaceId) || [];
      arr.push(m);
      workspaceGroups.set(m.workspaceId, arr);
    }

    let totalReduced = 0;

    for (const [workspaceId, wsMemories] of workspaceGroups) {
      if (wsMemories.length < config.compression.minClusterSize) continue;

      // LLM 生成摘要
      const { summary, importanceScore } = await llmService.compressMemoryCluster(
        wsMemories.map(m => ({
          id: m.id,
          content: m.content,
          createdAt: m.createdAt,
          importanceScore: m.importanceScore,
        }))
      );

      // 生成摘要向量
      const summaryVector = await embeddingService.generateEmbedding(summary);

      // 删除原始记忆，写入压缩摘要
      const idsToDelete = wsMemories.map(m => m.id);
      await milvusService.deleteMemoriesByIds(userId, idsToDelete);

      await milvusService.insertMemory(
        userId,
        workspaceId,
        summary,
        summaryVector,
        'general',
        0,
        importanceScore,
        destLevel
      );

      console.log(`[Compression] workspace=${workspaceId}: ${wsMemories.length} 条 → 1 条摘要 (level=${destLevel}, score=${importanceScore})`);
      totalReduced += wsMemories.length - 1;
    }

    return totalReduced;
  }

  /**
   * 计算两个向量之间的 L2 欧氏距离
   */
  private l2Distance(a: number[], b: number[]): number {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * 计算多个向量的均值向量
   */
  private meanVector(vectors: number[][]): number[] {
    if (vectors.length === 0) return [];
    const dim = vectors[0].length;
    const mean = new Array(dim).fill(0);
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) {
        mean[i] += v[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      mean[i] /= vectors.length;
    }
    return mean;
  }
}

export const compressionService = new CompressionService();
