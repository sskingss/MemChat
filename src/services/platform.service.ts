import { config } from '../config';
import { milvusService } from './milvus.service';
import { workingMemoryService } from './working-memory.service';
import { embeddingService } from './embedding.service';
import { memoryCleanupService } from './memory-cleanup.service';

export interface PlatformMetrics {
  uptime: number;
  uptimeHuman: string;
  environment: string;
  timestamp: string;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  workingMemory: {
    activeSessions: number;
    totalMessages: number;
    backend: string;
  };
  embeddingCache: {
    hits: number;
    misses: number;
    size: number;
    hitRate: string;
  };
  features: {
    redis: boolean;
    quota: boolean;
    graph: boolean;
    emotion: boolean;
    personaEvolution: boolean;
    mcp: boolean;
    multimodal: boolean;
    compression: boolean;
    workingMemory: boolean;
  };
}

export interface UserDashboard {
  memoryStats: {
    currentCount: number;
    maxCount: number;
    usagePercent: number;
    needsCleanup: boolean;
  };
}

/**
 * Cloud Hosted 平台服务
 *
 * 提供：
 * - 运行时指标（Prometheus 兼容格式）
 * - 用户 Dashboard 数据
 * - 健康检查增强
 * - 特性开关状态
 */
export class PlatformService {
  private startTime = Date.now();

  getMetrics(): PlatformMetrics {
    const mem = process.memoryUsage();
    const uptimeMs = Date.now() - this.startTime;
    const wmStats = workingMemoryService.getStats();
    const cacheStats = embeddingService.getCacheStats();

    return {
      uptime: uptimeMs,
      uptimeHuman: this.formatUptime(uptimeMs),
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
      },
      workingMemory: wmStats,
      embeddingCache: cacheStats,
      features: {
        redis: !!config.redis?.url,
        quota: config.quota.enabled,
        graph: config.graph.enabled,
        emotion: config.emotion.enabled,
        personaEvolution: config.personaEvolution.enabled,
        mcp: config.mcp.enabled,
        multimodal: config.multimodal.enabled,
        compression: config.compression.enabled,
        workingMemory: config.workingMemory.enabled,
      },
    };
  }

  /**
   * Prometheus 格式的 metrics
   */
  getPrometheusMetrics(): string {
    const m = this.getMetrics();
    const lines: string[] = [
      '# HELP memchat_uptime_seconds Uptime in seconds',
      '# TYPE memchat_uptime_seconds gauge',
      `memchat_uptime_seconds ${Math.round(m.uptime / 1000)}`,
      '',
      '# HELP memchat_heap_used_bytes Heap used in bytes',
      '# TYPE memchat_heap_used_bytes gauge',
      `memchat_heap_used_bytes ${m.memory.heapUsedMB * 1024 * 1024}`,
      '',
      '# HELP memchat_working_memory_sessions Active working memory sessions',
      '# TYPE memchat_working_memory_sessions gauge',
      `memchat_working_memory_sessions ${m.workingMemory.activeSessions}`,
      '',
      '# HELP memchat_embedding_cache_hits Total embedding cache hits',
      '# TYPE memchat_embedding_cache_hits counter',
      `memchat_embedding_cache_hits ${m.embeddingCache.hits}`,
      '',
      '# HELP memchat_embedding_cache_misses Total embedding cache misses',
      '# TYPE memchat_embedding_cache_misses counter',
      `memchat_embedding_cache_misses ${m.embeddingCache.misses}`,
      '',
      '# HELP memchat_embedding_cache_size Current embedding cache size',
      '# TYPE memchat_embedding_cache_size gauge',
      `memchat_embedding_cache_size ${m.embeddingCache.size}`,
    ];

    return lines.join('\n');
  }

  async getUserDashboard(userId: string): Promise<UserDashboard> {
    const memoryStats = await memoryCleanupService.getMemoryStats(userId);
    return { memoryStats };
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export const platformService = new PlatformService();
