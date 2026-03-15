import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

export interface WorkspaceQuota {
  workspaceId: string;
  userId: string;
  maxMemories: number;
  requestsPerMinute: number;
  llmModel: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 多租户配额管理服务
 *
 * 使用 SQLite 存储 workspace 级别的配额配置，
 * 支持 per-workspace 的 maxMemories、requestsPerMinute、llmModel 配置。
 */
export class QuotaService {
  private db: Database.Database | null = null;

  async init(): Promise<void> {
    if (!config.quota.enabled) {
      console.log('[Quota] 配额管理已禁用');
      return;
    }

    const dbPath = path.resolve(config.quota.dbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_quotas (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        max_memories INTEGER NOT NULL DEFAULT 1000,
        requests_per_minute INTEGER NOT NULL DEFAULT 60,
        llm_model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_request_log_user_ts
        ON request_log(user_id, timestamp);
    `);

    console.log('[Quota] 配额管理服务已初始化');
  }

  getOrCreateQuota(userId: string, workspaceId: string): WorkspaceQuota {
    if (!this.db) {
      return this.defaultQuota(userId, workspaceId);
    }

    const row = this.db.prepare(
      'SELECT * FROM workspace_quotas WHERE workspace_id = ? AND user_id = ?'
    ).get(workspaceId, userId) as any;

    if (row) {
      return {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        maxMemories: row.max_memories,
        requestsPerMinute: row.requests_per_minute,
        llmModel: row.llm_model,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    const now = Date.now();
    this.db.prepare(`
      INSERT INTO workspace_quotas (workspace_id, user_id, max_memories, requests_per_minute, llm_model, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(workspaceId, userId, config.quota.defaultMaxMemoriesPerWorkspace, config.quota.defaultRequestsPerMinute, now, now);

    return this.defaultQuota(userId, workspaceId);
  }

  updateQuota(userId: string, workspaceId: string, updates: Partial<Pick<WorkspaceQuota, 'maxMemories' | 'requestsPerMinute' | 'llmModel'>>): WorkspaceQuota {
    this.getOrCreateQuota(userId, workspaceId);

    if (!this.db) return this.defaultQuota(userId, workspaceId);

    const sets: string[] = [];
    const values: any[] = [];

    if (updates.maxMemories !== undefined) {
      sets.push('max_memories = ?');
      values.push(updates.maxMemories);
    }
    if (updates.requestsPerMinute !== undefined) {
      sets.push('requests_per_minute = ?');
      values.push(updates.requestsPerMinute);
    }
    if (updates.llmModel !== undefined) {
      sets.push('llm_model = ?');
      values.push(updates.llmModel);
    }

    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(workspaceId, userId);

    this.db.prepare(
      `UPDATE workspace_quotas SET ${sets.join(', ')} WHERE workspace_id = ? AND user_id = ?`
    ).run(...values);

    return this.getOrCreateQuota(userId, workspaceId);
  }

  /**
   * 检查请求频率是否超限
   */
  checkRateLimit(userId: string, workspaceId: string, endpoint: string): { allowed: boolean; remaining: number } {
    const quota = this.getOrCreateQuota(userId, workspaceId);

    if (!this.db) return { allowed: true, remaining: quota.requestsPerMinute };

    const oneMinuteAgo = Date.now() - 60_000;

    const count = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM request_log WHERE user_id = ? AND timestamp > ?'
    ).get(userId, oneMinuteAgo) as any)?.cnt || 0;

    // Log this request
    this.db.prepare(
      'INSERT INTO request_log (user_id, workspace_id, endpoint, timestamp) VALUES (?, ?, ?, ?)'
    ).run(userId, workspaceId, endpoint, Date.now());

    // Cleanup old entries periodically (keep last hour)
    const oneHourAgo = Date.now() - 3600_000;
    this.db.prepare('DELETE FROM request_log WHERE timestamp < ?').run(oneHourAgo);

    const remaining = Math.max(0, quota.requestsPerMinute - count - 1);
    return {
      allowed: count < quota.requestsPerMinute,
      remaining,
    };
  }

  listWorkspaceQuotas(userId: string): WorkspaceQuota[] {
    if (!this.db) return [];

    const rows = this.db.prepare(
      'SELECT * FROM workspace_quotas WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(userId) as any[];

    return rows.map(row => ({
      workspaceId: row.workspace_id,
      userId: row.user_id,
      maxMemories: row.max_memories,
      requestsPerMinute: row.requests_per_minute,
      llmModel: row.llm_model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private defaultQuota(userId: string, workspaceId: string): WorkspaceQuota {
    return {
      workspaceId,
      userId,
      maxMemories: config.quota.defaultMaxMemoriesPerWorkspace,
      requestsPerMinute: config.quota.defaultRequestsPerMinute,
      llmModel: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export const quotaService = new QuotaService();
