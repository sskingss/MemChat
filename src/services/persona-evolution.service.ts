import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { personaService } from './persona.service';
import { llmService } from './llm.service';
import type { UserPersona } from '../types';

export interface PersonaVersion {
  id: string;
  userId: string;
  version: number;
  personaSnapshot: string; // JSON
  changeReason: string;
  createdAt: number;
}

export interface PersonaEvolutionEntry {
  id: string;
  userId: string;
  chatCount: number;
  reflectionResult: string | null;
  createdAt: number;
}

/**
 * 人格进化服务
 *
 * 每 N 次对话触发 LLM 反思分析，动态更新 persona 的
 * core_traits、communication_style、lessons_learned 等字段。
 * 记录人格版本历史，支持查看演变轨迹。
 */
export class PersonaEvolutionService {
  private db: Database.Database | null = null;
  private chatCounters: Map<string, number> = new Map();

  async init(): Promise<void> {
    if (!config.personaEvolution.enabled) {
      console.log('[PersonaEvolution] 人格进化已禁用');
      return;
    }

    const dbPath = path.resolve(config.personaEvolution.dbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persona_versions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        persona_snapshot TEXT NOT NULL,
        change_reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evolution_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        chat_count INTEGER NOT NULL,
        reflection_result TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_versions_user ON persona_versions(user_id, version);
      CREATE INDEX IF NOT EXISTS idx_evolution_user ON evolution_log(user_id, created_at);
    `);

    console.log('[PersonaEvolution] 人格进化服务已初始化');
  }

  /**
   * 每次对话完成后调用，计数并在达到阈值时触发反思
   */
  async onChatCompleted(userId: string): Promise<void> {
    if (!config.personaEvolution.enabled) return;

    const count = (this.chatCounters.get(userId) || 0) + 1;
    this.chatCounters.set(userId, count);

    if (count >= config.personaEvolution.reflectEveryNChats) {
      this.chatCounters.set(userId, 0);
      await this.triggerReflection(userId);
    }
  }

  /**
   * 触发人格反思
   */
  async triggerReflection(userId: string): Promise<{ updated: boolean; changes: string }> {
    const persona = await personaService.getUserPersona(userId);
    if (!persona) return { updated: false, changes: 'No persona found' };

    try {
      const reflectionResult = await this.llmReflect(persona);

      if (!reflectionResult.shouldUpdate) {
        this.logEvolution(userId, 'No changes needed');
        return { updated: false, changes: reflectionResult.reason };
      }

      // Save current version before updating
      this.savePersonaVersion(userId, persona, reflectionResult.reason);

      // Apply updates
      const updates: Partial<UserPersona> = {};
      if (reflectionResult.newLessonsLearned && reflectionResult.newLessonsLearned.length > 0) {
        const existingLessons = persona.lessonsLearned || [];
        updates.lessonsLearned = [...existingLessons, ...reflectionResult.newLessonsLearned].slice(-20);
      }
      if (reflectionResult.communicationStyleUpdate) {
        updates.communicationStyle = reflectionResult.communicationStyleUpdate;
      }
      if (reflectionResult.newCoreTraits && reflectionResult.newCoreTraits.length > 0) {
        updates.coreTraits = reflectionResult.newCoreTraits;
      }

      if (Object.keys(updates).length > 0) {
        await personaService.updatePersona(userId, updates);
        console.log(`[PersonaEvolution] 用户 ${userId} 人格已进化: ${reflectionResult.reason}`);
      }

      this.logEvolution(userId, reflectionResult.reason);
      return { updated: true, changes: reflectionResult.reason };
    } catch (error) {
      console.error('[PersonaEvolution] 反思失败:', error);
      return { updated: false, changes: 'Reflection failed' };
    }
  }

  /**
   * 获取人格版本历史
   */
  getVersionHistory(userId: string, limit: number = 20): PersonaVersion[] {
    if (!this.db) return [];

    return (this.db.prepare(
      'SELECT * FROM persona_versions WHERE user_id = ? ORDER BY version DESC LIMIT ?'
    ).all(userId, limit) as any[]).map(row => ({
      id: row.id,
      userId: row.user_id,
      version: row.version,
      personaSnapshot: row.persona_snapshot,
      changeReason: row.change_reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * 获取进化日志
   */
  getEvolutionLog(userId: string, limit: number = 50): PersonaEvolutionEntry[] {
    if (!this.db) return [];

    return (this.db.prepare(
      'SELECT * FROM evolution_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as any[]).map(row => ({
      id: row.id,
      userId: row.user_id,
      chatCount: row.chat_count,
      reflectionResult: row.reflection_result,
      createdAt: row.created_at,
    }));
  }

  private async llmReflect(persona: UserPersona): Promise<{
    shouldUpdate: boolean;
    reason: string;
    newLessonsLearned?: string[];
    communicationStyleUpdate?: string;
    newCoreTraits?: string[];
  }> {
    const prompt = `你是一个人格进化分析助手。请分析以下 AI 人格配置，结合其已积累的经验教训，判断是否需要微调。

## 当前人格配置

- AI 名称: ${persona.aiName}
- 用户名称: ${persona.userName}
- 关系: ${persona.relationship}
- 核心特质: ${JSON.stringify(persona.coreTraits)}
- 沟通风格: ${persona.communicationStyle}
- 经验教训: ${JSON.stringify(persona.lessonsLearned || [])}

## 分析要求

1. 根据已有的经验教训，判断是否有模式值得提炼为新的 core trait
2. 判断沟通风格是否需要微调
3. 提出新的经验教训（如果有）

请以 JSON 格式返回：
{
  "shouldUpdate": true/false,
  "reason": "更新原因",
  "newLessonsLearned": ["新经验1"],
  "communicationStyleUpdate": "微调后的沟通风格（如不需要则为 null）",
  "newCoreTraits": ["如需更新核心特质，提供完整列表；否则为 null"]
}

只返回 JSON。`;

    const response = await (llmService as any).openai.chat.completions.create({
      model: config.llm.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { shouldUpdate: false, reason: 'Empty response' };

    return JSON.parse(content);
  }

  private savePersonaVersion(userId: string, persona: UserPersona, changeReason: string): void {
    if (!this.db) return;

    const maxVersion = (this.db.prepare(
      'SELECT MAX(version) as max_ver FROM persona_versions WHERE user_id = ?'
    ).get(userId) as any)?.max_ver || 0;

    this.db.prepare(
      'INSERT INTO persona_versions (id, user_id, version, persona_snapshot, change_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, maxVersion + 1, JSON.stringify(persona), changeReason, Date.now());
  }

  private logEvolution(userId: string, result: string): void {
    if (!this.db) return;

    this.db.prepare(
      'INSERT INTO evolution_log (id, user_id, chat_count, reflection_result, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, this.chatCounters.get(userId) || 0, result, Date.now());
  }
}

export const personaEvolutionService = new PersonaEvolutionService();
