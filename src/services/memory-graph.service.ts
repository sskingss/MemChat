import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

export interface GraphEntity {
  id: string;
  userId: string;
  name: string;
  entityType: string; // person, place, concept, project, skill, etc.
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GraphRelation {
  id: string;
  userId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string; // relates_to, used_in, works_at, likes, etc.
  description: string | null;
  memoryId: string | null; // link back to the memory that created this relation
  strength: number; // 1-10
  createdAt: number;
}

export interface GraphQueryResult {
  entities: GraphEntity[];
  relations: GraphRelation[];
}

/**
 * 记忆知识图谱服务
 *
 * 使用 SQLite 存储实体和关系，构建用户的知识图谱。
 * LLM Pipeline 提取实体和关系时写入，检索时通过图谱扩展查询范围。
 */
export class MemoryGraphService {
  private db: Database.Database | null = null;

  async init(): Promise<void> {
    if (!config.graph.enabled) {
      console.log('[MemoryGraph] 知识图谱已禁用');
      return;
    }

    const dbPath = path.resolve(config.graph.dbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL DEFAULT 'concept',
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'relates_to',
        description TEXT,
        memory_id TEXT,
        strength INTEGER NOT NULL DEFAULT 5,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_entities_user ON entities(user_id);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(user_id, name);
      CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relations_memory ON relations(memory_id);
    `);

    console.log('[MemoryGraph] 知识图谱服务已初始化');
  }

  /**
   * 添加或更新实体
   */
  upsertEntity(userId: string, name: string, entityType: string, description?: string): GraphEntity {
    if (!this.db) return this.mockEntity(userId, name, entityType);

    const normalizedName = name.toLowerCase().trim();
    const now = Date.now();

    const existing = this.db.prepare(
      'SELECT * FROM entities WHERE user_id = ? AND LOWER(name) = ?'
    ).get(userId, normalizedName) as any;

    if (existing) {
      this.db.prepare(
        'UPDATE entities SET entity_type = ?, description = COALESCE(?, description), updated_at = ? WHERE id = ?'
      ).run(entityType, description || null, now, existing.id);
      return { ...this.rowToEntity(existing), entityType, updatedAt: now };
    }

    const id = uuidv4();
    this.db.prepare(
      'INSERT INTO entities (id, user_id, name, entity_type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, name, entityType, description || null, now, now);

    return { id, userId, name, entityType, description: description || null, createdAt: now, updatedAt: now };
  }

  /**
   * 添加关系
   */
  addRelation(userId: string, sourceEntityId: string, targetEntityId: string, relationType: string, memoryId?: string, description?: string, strength: number = 5): GraphRelation {
    if (!this.db) return this.mockRelation(userId, sourceEntityId, targetEntityId, relationType);

    // Check if relation already exists
    const existing = this.db.prepare(
      'SELECT * FROM relations WHERE user_id = ? AND source_entity_id = ? AND target_entity_id = ? AND relation_type = ?'
    ).get(userId, sourceEntityId, targetEntityId, relationType) as any;

    if (existing) {
      // Strengthen existing relation
      const newStrength = Math.min(10, existing.strength + 1);
      this.db.prepare('UPDATE relations SET strength = ? WHERE id = ?').run(newStrength, existing.id);
      return { ...this.rowToRelation(existing), strength: newStrength };
    }

    const id = uuidv4();
    const now = Date.now();
    this.db.prepare(
      'INSERT INTO relations (id, user_id, source_entity_id, target_entity_id, relation_type, description, memory_id, strength, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, sourceEntityId, targetEntityId, relationType, description || null, memoryId || null, strength, now);

    return { id, userId, sourceEntityId, targetEntityId, relationType, description: description || null, memoryId: memoryId || null, strength, createdAt: now };
  }

  /**
   * 从 LLM 提取的实体关系数据批量导入
   */
  async importFromExtraction(
    userId: string,
    extraction: { entities: Array<{ name: string; type: string; description?: string }>; relations: Array<{ source: string; target: string; type: string; description?: string }> },
    memoryId?: string
  ): Promise<{ entitiesCount: number; relationsCount: number }> {
    if (!this.db) return { entitiesCount: 0, relationsCount: 0 };

    const entityMap = new Map<string, GraphEntity>();

    for (const e of extraction.entities) {
      const entity = this.upsertEntity(userId, e.name, e.type, e.description);
      entityMap.set(e.name.toLowerCase().trim(), entity);
    }

    let relationsCount = 0;
    for (const r of extraction.relations) {
      const source = entityMap.get(r.source.toLowerCase().trim());
      const target = entityMap.get(r.target.toLowerCase().trim());
      if (source && target) {
        this.addRelation(userId, source.id, target.id, r.type, memoryId, r.description);
        relationsCount++;
      }
    }

    return { entitiesCount: entityMap.size, relationsCount };
  }

  /**
   * 查询用户的完整知识图谱
   */
  getGraph(userId: string, limit: number = 200): GraphQueryResult {
    if (!this.db) return { entities: [], relations: [] };

    const entities = (this.db.prepare(
      'SELECT * FROM entities WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?'
    ).all(userId, limit) as any[]).map(this.rowToEntity);

    const entityIds = entities.map(e => e.id);
    if (entityIds.length === 0) return { entities, relations: [] };

    const placeholders = entityIds.map(() => '?').join(',');
    const relations = (this.db.prepare(
      `SELECT * FROM relations WHERE user_id = ? AND (source_entity_id IN (${placeholders}) OR target_entity_id IN (${placeholders})) ORDER BY strength DESC`
    ).all(userId, ...entityIds, ...entityIds) as any[]).map(this.rowToRelation);

    return { entities, relations };
  }

  /**
   * 根据实体名称搜索相关实体（1-hop 图遍历）
   */
  findRelatedEntities(userId: string, entityName: string, depth: number = 1): GraphEntity[] {
    if (!this.db) return [];

    const entity = this.db.prepare(
      'SELECT * FROM entities WHERE user_id = ? AND LOWER(name) = ?'
    ).get(userId, entityName.toLowerCase().trim()) as any;

    if (!entity) return [];

    const visited = new Set<string>([entity.id]);
    let frontier = [entity.id];

    for (let d = 0; d < depth; d++) {
      if (frontier.length === 0) break;
      const placeholders = frontier.map(() => '?').join(',');

      const related = this.db.prepare(
        `SELECT DISTINCT CASE
           WHEN source_entity_id IN (${placeholders}) THEN target_entity_id
           ELSE source_entity_id
         END as related_id
         FROM relations
         WHERE user_id = ? AND (source_entity_id IN (${placeholders}) OR target_entity_id IN (${placeholders}))`
      ).all(...frontier, userId, ...frontier, ...frontier) as any[];

      frontier = [];
      for (const r of related) {
        if (!visited.has(r.related_id)) {
          visited.add(r.related_id);
          frontier.push(r.related_id);
        }
      }
    }

    visited.delete(entity.id); // Remove the query entity itself
    if (visited.size === 0) return [];

    const ids = Array.from(visited);
    const placeholders2 = ids.map(() => '?').join(',');

    return (this.db.prepare(
      `SELECT * FROM entities WHERE id IN (${placeholders2})`
    ).all(...ids) as any[]).map(this.rowToEntity);
  }

  /**
   * 删除实体及其关系
   */
  deleteEntity(userId: string, entityId: string): boolean {
    if (!this.db) return false;

    const entity = this.db.prepare('SELECT * FROM entities WHERE id = ? AND user_id = ?').get(entityId, userId);
    if (!entity) return false;

    this.db.prepare('DELETE FROM relations WHERE (source_entity_id = ? OR target_entity_id = ?) AND user_id = ?').run(entityId, entityId, userId);
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(entityId);
    return true;
  }

  private rowToEntity(row: any): GraphEntity {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      entityType: row.entity_type,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToRelation(row: any): GraphRelation {
    return {
      id: row.id,
      userId: row.user_id,
      sourceEntityId: row.source_entity_id,
      targetEntityId: row.target_entity_id,
      relationType: row.relation_type,
      description: row.description,
      memoryId: row.memory_id,
      strength: row.strength,
      createdAt: row.created_at,
    };
  }

  private mockEntity(userId: string, name: string, entityType: string): GraphEntity {
    return { id: uuidv4(), userId, name, entityType, description: null, createdAt: Date.now(), updatedAt: Date.now() };
  }

  private mockRelation(userId: string, source: string, target: string, type: string): GraphRelation {
    return { id: uuidv4(), userId, sourceEntityId: source, targetEntityId: target, relationType: type, description: null, memoryId: null, strength: 5, createdAt: Date.now() };
  }
}

export const memoryGraphService = new MemoryGraphService();
