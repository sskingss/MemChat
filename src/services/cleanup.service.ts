import { milvusService } from './milvus.service';

// 默认清理间隔：每小时
const DEFAULT_CLEANUP_INTERVAL = 60 * 60 * 1000;

/**
 * 清理服务
 *
 * 负责定时清理过期的记忆（主要是 todo 类型）
 */
export class CleanupService {
  private interval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * 启动定时清理任务
   *
   * @param intervalMs 清理间隔（毫秒），默认每小时
   */
  start(intervalMs: number = DEFAULT_CLEANUP_INTERVAL): void {
    if (this.interval) {
      console.log('[CleanupService] 清理服务已在运行中');
      return;
    }

    console.log(`[CleanupService] 启动清理服务，间隔: ${intervalMs / 1000 / 60} 分钟`);

    // 立即执行一次清理
    this.cleanExpiredMemories();

    // 设置定时任务
    this.interval = setInterval(() => {
      this.cleanExpiredMemories();
    }, intervalMs);
  }

  /**
   * 停止定时清理任务
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[CleanupService] 清理服务已停止');
    }
  }

  /**
   * 执行一次过期记忆清理
   */
  async cleanExpiredMemories(): Promise<number> {
    if (this.isRunning) {
      console.log('[CleanupService] 清理任务正在执行中，跳过本次');
      return 0;
    }

    this.isRunning = true;

    try {
      console.log('[CleanupService] 开始清理过期记忆...');
      const count = await milvusService.deleteExpiredMemories();

      if (count > 0) {
        console.log(`[CleanupService] 清理完成，删除了 ${count} 条过期记忆`);
      }

      return count;
    } catch (error) {
      console.error('[CleanupService] 清理过期记忆失败:', error);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取服务状态
   */
  getStatus(): { isRunning: boolean; hasInterval: boolean } {
    return {
      isRunning: this.isRunning,
      hasInterval: this.interval !== null,
    };
  }
}

// 单例模式
export const cleanupService = new CleanupService();
