import { config } from '../config';
import type { WorkingMemorySession, WorkingMemoryMessage } from '../types';

/**
 * Working Memory 服务（会话级短期记忆）
 *
 * 对标认知科学中的"工作记忆"概念：
 * - 存储最近 N 轮对话的完整上下文
 * - 让 LLM 能够感知多轮对话历史，无需依赖长期记忆检索
 * - 会话超过 TTL 后自动过期
 *
 * 与长期记忆的区别：
 * - Working Memory：短暂，会话内有效，直接注入 LLM 消息列表
 * - Long-term Memory（Milvus）：持久，跨会话有效，通过 RAG 检索
 *
 * 存储方式：内存 Map（重启后清空，这是预期行为，会话历史不需要持久化）
 */
export class WorkingMemoryService {
  private sessions: Map<string, WorkingMemorySession> = new Map();
  private cleanupIntervalMs = 5 * 60 * 1000; // 每 5 分钟清理一次过期会话

  constructor() {
    if (config.workingMemory.enabled) {
      this.startCleanupTimer();
    }
  }

  /**
   * 获取或创建会话
   *
   * @param sessionId   会话 ID（由客户端提供或自动生成）
   * @param userId      用户 ID
   * @param workspaceId 工作空间 ID
   */
  getOrCreateSession(sessionId: string, userId: string, workspaceId: string): WorkingMemorySession {
    const existing = this.sessions.get(sessionId);

    if (existing && existing.userId === userId) {
      // 检查是否过期
      const ttlMs = config.workingMemory.sessionTtlMinutes * 60 * 1000;
      if (Date.now() - existing.updatedAt < ttlMs) {
        return existing;
      }
      // 已过期，删除并重建
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

  /**
   * 追加消息到会话
   *
   * 自动裁剪超出 maxMessages 的旧消息
   */
  appendMessages(
    sessionId: string,
    userId: string,
    userMessage: string,
    assistantReply: string
  ): void {
    if (!config.workingMemory.enabled) return;

    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return;

    const now = Date.now();
    session.messages.push(
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantReply, timestamp: now }
    );

    // 保留最新的 maxMessages 条（每轮对话 2 条）
    const max = config.workingMemory.maxMessages;
    if (session.messages.length > max) {
      session.messages = session.messages.slice(session.messages.length - max);
    }

    session.updatedAt = now;
  }

  /**
   * 获取会话历史（不含当前消息，用于 LLM 上下文注入）
   *
   * 返回最近的消息列表，供 LLM chat() 方法使用
   */
  getSessionHistory(sessionId: string, userId: string): WorkingMemoryMessage[] {
    if (!config.workingMemory.enabled) return [];

    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return [];

    const ttlMs = config.workingMemory.sessionTtlMinutes * 60 * 1000;
    if (Date.now() - session.updatedAt > ttlMs) {
      this.sessions.delete(sessionId);
      return [];
    }

    return [...session.messages];
  }

  /**
   * 清除指定会话（用户主动结束会话时调用）
   */
  clearSession(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.userId === userId) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { activeSessions: number; totalMessages: number } {
    let totalMessages = 0;
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
    }
    return { activeSessions: this.sessions.size, totalMessages };
  }

  /**
   * 生成默认 sessionId（当客户端不提供时使用）
   *
   * 格式：{userId}:{workspaceId} — 每个用户每个 workspace 维护一个长期会话
   */
  static buildDefaultSessionId(userId: string, workspaceId: string): string {
    return `${userId}:${workspaceId}`;
  }

  /**
   * 定时清理过期会话，防止内存泄漏
   */
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
