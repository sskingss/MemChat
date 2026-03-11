import { milvusService } from './milvus.service';
import { llmService } from './llm.service';
import { config } from '../config';

/**
 * 记忆清理服务
 *
 * 负责：
 * 1. 监控用户记忆数量
 * 2. 超过阈值时触发智能清理
 * 3. 使用 LLM 评估记忆价值
 */
export class MemoryCleanupService {
  /**
   * 检查并清理用户记忆
   *
   * @param userId 用户 ID
   * @returns 清理的记忆数量
   */
  async checkAndCleanup(userId: string): Promise<number> {
    const { maxMemoriesPerUser, cleanupThreshold, cleanupTarget, cleanupBatchSize } = config.memory;

    try {
      // 1. 统计当前记忆数量
      const currentCount = await milvusService.countMemories(userId);

      const thresholdCount = Math.floor(maxMemoriesPerUser * cleanupThreshold);
      const targetCount = Math.floor(maxMemoriesPerUser * cleanupTarget);

      console.log(`[MemoryCleanup] 用户 ${userId} 当前记忆数: ${currentCount}, 阈值: ${thresholdCount}`);

      // 2. 检查是否超过阈值
      if (currentCount < thresholdCount) {
        return 0;
      }

      console.log(`[MemoryCleanup] 超过阈值，开始清理...`);

      // 3. 计算需要清理的数量
      const needToDelete = currentCount - targetCount;
      let totalDeleted = 0;

      // 4. 先清理过期的记忆
      const expiredDeleted = await milvusService.deleteExpiredMemories();
      totalDeleted += expiredDeleted;
      console.log(`[MemoryCleanup] 清理过期记忆: ${expiredDeleted} 条`);

      // 5. 如果还不够，使用 LLM 评估清理
      if (totalDeleted < needToDelete) {
        const remaining = needToDelete - totalDeleted;

        // 获取最老的记忆进行评估
        const oldestMemories = await milvusService.getOldestMemories(userId, cleanupBatchSize);

        if (oldestMemories.length > 0) {
          // LLM 评估保留价值
          const evaluations = await llmService.evaluateMemoryRetention(oldestMemories);

          // 找出可以删除的记忆
          const toDelete = evaluations
            .filter(e => !e.shouldKeep)
            .slice(0, remaining)
            .map(e => e.id);

          if (toDelete.length > 0) {
            const deleted = await milvusService.deleteMemoriesByIds(userId, toDelete);
            totalDeleted += deleted;
            console.log(`[MemoryCleanup] LLM 评估清理: ${deleted} 条`);
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
