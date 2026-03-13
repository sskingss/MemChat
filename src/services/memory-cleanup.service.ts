import { milvusService } from './milvus.service';
import { llmService } from './llm.service';
import { compressionService } from './compression.service';
import { config } from '../config';

/**
 * 记忆清理服务
 *
 * 职责：
 * 1. 监控用户记忆数量
 * 2. 超过阈值时先尝试聚类压缩，再按综合保留分值评估删除
 */
export class MemoryCleanupService {
  /**
   * 检查并清理用户记忆
   *
   * 流程：
   * 1. 统计当前数量
   * 2. 若超过触发阈值：先清理过期记忆
   * 3. 若仍超阈值：触发聚类压缩（compression.service）
   * 4. 若压缩后仍超阈值：按综合评分（importance + access - age）删除低价值记忆
   *
   * @returns 清理的记忆数量
   */
  async checkAndCleanup(userId: string): Promise<number> {
    const { maxMemoriesPerUser, cleanupThreshold, cleanupTarget, cleanupBatchSize } = config.memory;

    try {
      const currentCount = await milvusService.countMemories(userId);
      const thresholdCount = Math.floor(maxMemoriesPerUser * cleanupThreshold);
      const targetCount = Math.floor(maxMemoriesPerUser * cleanupTarget);

      console.log(`[MemoryCleanup] 用户 ${userId} 当前记忆数: ${currentCount}, 阈值: ${thresholdCount}`);

      if (currentCount < thresholdCount) {
        return 0;
      }

      console.log(`[MemoryCleanup] 超过阈值，开始清理...`);
      let totalDeleted = 0;

      // 第一步：清理过期记忆
      const expiredDeleted = await milvusService.deleteExpiredMemories();
      totalDeleted += expiredDeleted;
      console.log(`[MemoryCleanup] 清理过期记忆: ${expiredDeleted} 条`);

      const countAfterExpired = await milvusService.countMemories(userId);
      if (countAfterExpired < thresholdCount) {
        console.log(`[MemoryCleanup] 清理过期记忆后已达标，共删除 ${totalDeleted} 条`);
        return totalDeleted;
      }

      // 第二步：触发聚类压缩（可能大幅减少记忆数量）
      const compressReduced = await compressionService.checkAndCompress(userId);
      if (compressReduced) {
        const countAfterCompress = await milvusService.countMemories(userId);
        const compressionGain = countAfterExpired - countAfterCompress;
        totalDeleted += compressionGain;
        console.log(`[MemoryCleanup] 聚类压缩后减少: ${compressionGain} 条，当前: ${countAfterCompress}`);

        if (countAfterCompress < thresholdCount) {
          console.log(`[MemoryCleanup] 压缩后已达标，共删除 ${totalDeleted} 条`);
          return totalDeleted;
        }
      }

      // 第三步：按综合保留分值评估，删除低价值记忆
      const currentCountFinal = await milvusService.countMemories(userId);
      const needToDelete = currentCountFinal - targetCount;

      if (needToDelete > 0) {
        // getMemoriesForCleanup 已按 retention_score 升序排列（低分优先删除）
        const candidates = await milvusService.getMemoriesForCleanup(userId, cleanupBatchSize);

        if (candidates.length > 0) {
          const evaluations = await llmService.evaluateMemoryRetention(
            candidates.map(m => ({
              id: m.id,
              content: m.content,
              createdAt: m.createdAt,
            }))
          );

          const toDelete = evaluations
            .filter(e => !e.shouldKeep)
            .slice(0, needToDelete)
            .map(e => e.id);

          if (toDelete.length > 0) {
            const deleted = await milvusService.deleteMemoriesByIds(userId, toDelete);
            totalDeleted += deleted;
            console.log(`[MemoryCleanup] 综合评分清理: ${deleted} 条`);
          }
        }
      }

      console.log(`[MemoryCleanup] 清理完成，共删除 ${totalDeleted} 条记忆`);
      return totalDeleted;
    } catch (error) {
      console.error('[MemoryCleanup] 清理失败:', error);
      return 0;
    }
  }

  /**
   * 获取用户记忆统计信息
   */
  async getMemoryStats(userId: string): Promise<{
    currentCount: number;
    maxCount: number;
    usagePercent: number;
    needsCleanup: boolean;
  }> {
    const { maxMemoriesPerUser, cleanupThreshold } = config.memory;

    const currentCount = await milvusService.countMemories(userId);
    const thresholdCount = Math.floor(maxMemoriesPerUser * cleanupThreshold);

    return {
      currentCount,
      maxCount: maxMemoriesPerUser,
      usagePercent: Math.round((currentCount / maxMemoriesPerUser) * 100),
      needsCleanup: currentCount >= thresholdCount,
    };
  }
}

export const memoryCleanupService = new MemoryCleanupService();
