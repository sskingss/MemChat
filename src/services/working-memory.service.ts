import Redis from 'ioredis';
import { config } from '../config';
import type { WorkingMemorySession, WorkingMemoryMessage } from '../types';

/**
 * Working Memory 服务（会话级短期记忆）
 *
 * 支持两种存储后端：
 * - Redis（生产环境推荐）：服务重启后会话数据不丢失，支持多实例部署
 * - 内存 Map（开发/无 Redis 时降级）：重启后清空
 */
export class WorkingMemoryService {
  private sessions: Map<string, WorkingMemorySession> = new Map();
  private redis: Redis | null = null;
  private useRedis: boolean;
  private cleanupIntervalMs = 5 * 60 * 1000;

  constructor() {
    this.useRedis = config.workingMemory.enabled && !!config.redis?.url;

    if (this.useRedis) {
      try {
        this.redis = new Redis(config.redis!.url, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        });
        this.redis.on('error', (err) => {
          console.error('[WorkingMemory] Redis 连接错误，降级为内存存储:', err.message);
          this.useRedis = false;
          this.redis = null;
        });
        this.redis.connect().then(() => {
          console.log('[WorkingMemory] Redis 连接成功');
        }).catch((err) => {
          console.warn('[WorkingMemory] Redis 连接失败，降级为内存存储:', err.message);
          this.useRedis = false;
          this.redis = null;
        });
      } catch {
        console.warn('[WorkingMemory] Redis 初始化失败，使用内存存储');
        this.useRedis = false;
      }
    }

    if (config.workingMemory.enabled) {
      this.startCleanupTimer();
    }
  }

  private redisKey(sessionId: string): string {
    return `memchat:session:${sessionId}`;
  }

  async getOrCreateSession(sessionId: string, userId: string, workspaceId: string): Promise<WorkingMemorySession> {
    if (this.useRedis && this.redis) {
      return this.getOrCreateSessionRedis(sessionId, userId, workspaceId);
    }
    return this.getOrCreateSessionMemory(sessionId, userId, workspaceId);
  }

  private async getOrCreateSessionRedis(sessionId: string, userId: string, workspaceId: string): Promise<WorkingMemorySession> {
    const key = this.redisKey(sessionId);
    const data = await this.redis!.get(key);

    if (data) {
      const session: WorkingMemorySession = JSON.parse(data);
      if (session.userId === userId) {
        const ttlMs = config.workingMemory.sessionTtlMinutes * 60 * 1000;
        if (Date.now() - session.updatedAt < ttlMs) {
          return session;
        }
      }
      await this.redis!.del(key);
    }

    const session: WorkingMemorySession = {
      sessionId,
      userId,
      workspaceId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ttlSeconds = config.workingMemory.sessionTtlMinutes * 60;
    await this.redis!.set(key, JSON.stringify(session), 'EX', ttlSeconds);
    return session;
  }

  private getOrCreateSessionMemory(sessionId: string, userId: string, workspaceId: string): WorkingMemorySession {
    const existing = this.sessions.get(sessionId);

    if (existing && existing.userId === userId) {
      const ttlMs = config.workingMemory.sessionTtlMinutes * 60 * 1000;
      if (Date.now() - existing.updatedAt < ttlMs) {
        return existing;
      }
      this.sessions.delete(sessionId);
    }

    const session: WorkingMemorySession = {
      sessionId,
      userId,
      workspaceId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async appendMessages(
    sessionId: string,
    userId: string,
    userMessage: string,
    assistantReply: string
  ): Promise<void> {
    if (!config.workingMemory.enabled) return;

    if (this.useRedis && this.redis) {
      return this.appendMessagesRedis(sessionId, userId, userMessage, assistantReply);
    }
    return this.appendMessagesMemory(sessionId, userId, userMessage, assistantReply);
  }

  private async appendMessagesRedis(
    sessionId: string,
    userId: string,
    userMessage: string,
    assistantReply: string
  ): Promise<void> {
    const key = this.redisKey(sessionId);
    const data = await this.redis!.get(key);
    if (!data) return;

    const session: WorkingMemorySession = JSON.parse(data);
    if (session.userId !== userId) return;

    const now = Date.now();
    session.messages.push(
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantReply, timestamp: now }
    );

    const max = config.workingMemory.maxMessages;
    if (session.messages.length > max) {
      session.messages = session.messages.slice(session.messages.length - max);
    }

    session.updatedAt = now;
    const ttlSeconds = config.workingMemory.sessionTtlMinutes * 60;
    await this.redis!.set(key, JSON.stringify(session), 'EX', ttlSeconds);
  }

  private appendMessagesMemory(
    sessionId: string,
    userId: string,
    userMessage: string,
    assistantReply: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return;

    const now = Date.now();
    session.messages.push(
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantReply, timestamp: now }
    );

    const max = config.workingMemory.maxMessages;
    if (session.messages.length > max) {
      session.messages = session.messages.slice(session.messages.length - max);
    }

    session.updatedAt = now;
  }

  async getSessionHistory(sessionId: string, userId: string): Promise<WorkingMemoryMessage[]> {
    if (!config.workingMemory.enabled) return [];

    if (this.useRedis && this.redis) {
      return this.getSessionHistoryRedis(sessionId, userId);
    }
    return this.getSessionHistoryMemory(sessionId, userId);
  }

  private async getSessionHistoryRedis(sessionId: string, userId: string): Promise<WorkingMemoryMessage[]> {
    const key = this.redisKey(sessionId);
    const data = await this.redis!.get(key);
    if (!data) return [];

    const session: WorkingMemorySession = JSON.parse(data);
    if (session.userId !== userId) return [];

    const ttlMs = config.workingMemory.sessionTtlMinutes * 60 * 1000;
    if (Date.now() - session.updatedAt > ttlMs) {
      await this.redis!.del(key);
      return [];
    }

    return [...session.messages];
  }

  private getSessionHistoryMemory(sessionId: string, userId: string): WorkingMemoryMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return [];

    const ttlMs = config.workingMemory.sessionTtlMinutes * 60 * 1000;
    if (Date.now() - session.updatedAt > ttlMs) {
      this.sessions.delete(sessionId);
      return [];
    }

    return [...session.messages];
  }

  async clearSession(sessionId: string, userId: string): Promise<void> {
    if (this.useRedis && this.redis) {
      const key = this.redisKey(sessionId);
      const data = await this.redis.get(key);
      if (data) {
        const session: WorkingMemorySession = JSON.parse(data);
        if (session.userId === userId) {
          await this.redis.del(key);
        }
      }
      return;
    }
    const session = this.sessions.get(sessionId);
    if (session && session.userId === userId) {
      this.sessions.delete(sessionId);
    }
  }

  getStats(): { activeSessions: number; totalMessages: number; backend: string } {
    let totalMessages = 0;
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
    }
    return {
      activeSessions: this.sessions.size,
      totalMessages,
      backend: this.useRedis ? 'redis' : 'memory',
    };
  }

  static buildDefaultSessionId(userId: string, workspaceId: string): string {
    return `${userId}:${workspaceId}`;
  }

  private startCleanupTimer(): void {
    setInterval(() => {
      const ttlMs = config.workingMemory.sessionTtlMinutes * 60 * 1000;
      const now = Date.now();
      let cleaned = 0;

      for (const [id, session] of this.sessions.entries()) {
        if (now - session.updatedAt > ttlMs) {
          this.sessions.delete(id);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[WorkingMemory] 清理了 ${cleaned} 个过期会话`);
      }
    }, this.cleanupIntervalMs);
  }
}

export const workingMemoryService = new WorkingMemoryService();
