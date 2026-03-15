import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

export interface EmotionRecord {
  id: string;
  userId: string;
  valence: number;   // -1.0 (negative) to 1.0 (positive)
  arousal: number;    // 0.0 (calm) to 1.0 (excited)
  dominantEmotion: string; // happy, sad, angry, anxious, neutral, etc.
  confidence: number; // 0-1
  trigger: string;    // what caused the emotion (short summary)
  createdAt: number;
}

export interface EmotionTimeline {
  records: EmotionRecord[];
  averageValence: number;
  averageArousal: number;
  dominantEmotionLast7Days: string;
}

/**
 * 情绪状态追踪服务
 *
 * 对每次对话进行轻量级情绪检测（基于规则 + 关键词），
 * 存储到 SQLite 中，支持查询情绪时间线。
 * 在 Persona 系统提示中注入当前情绪上下文。
 */
export class EmotionService {
  private db: Database.Database | null = null;

  private emotionKeywords: Record<string, { valence: number; arousal: number; keywords: string[] }> = {
    happy: { valence: 0.8, arousal: 0.6, keywords: ['开心', '高兴', '太好了', '感谢', '棒', '喜欢', 'happy', 'great', 'awesome', 'love', '哈哈', '😄', '🎉'] },
    excited: { valence: 0.9, arousal: 0.9, keywords: ['激动', '兴奋', '太棒了', '期待', 'excited', 'amazing', 'wow', '！！'] },
    sad: { valence: -0.7, arousal: 0.3, keywords: ['难过', '伤心', '失望', '遗憾', 'sad', 'disappointed', '😢', '唉'] },
    angry: { valence: -0.8, arousal: 0.8, keywords: ['生气', '愤怒', '烦', '讨厌', 'angry', 'annoying', '烦死了'] },
    anxious: { valence: -0.5, arousal: 0.7, keywords: ['焦虑', '担心', '紧张', '压力', 'anxious', 'worried', 'stressed'] },
    grateful: { valence: 0.7, arousal: 0.4, keywords: ['感谢', '谢谢', '感恩', 'thanks', 'thank you', 'grateful'] },
    confused: { valence: -0.2, arousal: 0.5, keywords: ['困惑', '不懂', '不明白', 'confused', "don't understand", '？？'] },
    neutral: { valence: 0, arousal: 0.3, keywords: [] },
  };

  async init(): Promise<void> {
    if (!config.emotion.enabled) {
      console.log('[Emotion] 情绪追踪已禁用');
      return;
    }

    const dbPath = path.resolve(config.emotion.dbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS emotions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        valence REAL NOT NULL,
        arousal REAL NOT NULL,
        dominant_emotion TEXT NOT NULL,
        confidence REAL NOT NULL,
        trigger_text TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_emotions_user ON emotions(user_id, created_at);
    `);

    console.log('[Emotion] 情绪追踪服务已初始化');
  }

  /**
   * 从对话中检测并记录情绪
   */
  async trackEmotion(userId: string, userMessage: string, assistantReply: string): Promise<EmotionRecord | null> {
    if (!config.emotion.enabled || !this.db) return null;

    const detection = this.detectEmotion(userMessage);

    const record: EmotionRecord = {
      id: uuidv4(),
      userId,
      valence: detection.valence,
      arousal: detection.arousal,
      dominantEmotion: detection.dominantEmotion,
      confidence: detection.confidence,
      trigger: userMessage.substring(0, 200),
      createdAt: Date.now(),
    };

    this.db.prepare(
      'INSERT INTO emotions (id, user_id, valence, arousal, dominant_emotion, confidence, trigger_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(record.id, record.userId, record.valence, record.arousal, record.dominantEmotion, record.confidence, record.trigger, record.createdAt);

    return record;
  }

  /**
   * 获取用户情绪时间线
   */
  getTimeline(userId: string, days: number = 7, limit: number = 100): EmotionTimeline {
    if (!this.db) return { records: [], averageValence: 0, averageArousal: 0, dominantEmotionLast7Days: 'neutral' };

    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const rows = this.db.prepare(
      'SELECT * FROM emotions WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, since, limit) as any[];

    const records = rows.map(this.rowToRecord);

    const avgValence = records.length > 0
      ? records.reduce((sum, r) => sum + r.valence, 0) / records.length
      : 0;
    const avgArousal = records.length > 0
      ? records.reduce((sum, r) => sum + r.arousal, 0) / records.length
      : 0;

    // Dominant emotion by frequency
    const emotionCounts = new Map<string, number>();
    for (const r of records) {
      emotionCounts.set(r.dominantEmotion, (emotionCounts.get(r.dominantEmotion) || 0) + 1);
    }
    let dominant = 'neutral';
    let maxCount = 0;
    for (const [emotion, count] of emotionCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = emotion;
      }
    }

    return {
      records,
      averageValence: Math.round(avgValence * 100) / 100,
      averageArousal: Math.round(avgArousal * 100) / 100,
      dominantEmotionLast7Days: dominant,
    };
  }

  /**
   * 获取当前情绪上下文（用于注入 Persona 系统提示）
   */
  getCurrentEmotionContext(userId: string): string | null {
    if (!this.db) return null;

    const recent = this.db.prepare(
      'SELECT * FROM emotions WHERE user_id = ? ORDER BY created_at DESC LIMIT 3'
    ).all(userId) as any[];

    if (recent.length === 0) return null;

    const latest = this.rowToRecord(recent[0]);
    const emotionLabel = this.getEmotionLabel(latest.valence, latest.dominantEmotion);

    return `用户近期情绪状态: ${emotionLabel}`;
  }

  private detectEmotion(text: string): { valence: number; arousal: number; dominantEmotion: string; confidence: number } {
    const lower = text.toLowerCase();
    let bestMatch = 'neutral';
    let bestScore = 0;

    for (const [emotion, data] of Object.entries(this.emotionKeywords)) {
      if (emotion === 'neutral') continue;
      let score = 0;
      for (const kw of data.keywords) {
        if (lower.includes(kw.toLowerCase())) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = emotion;
      }
    }

    const matched = this.emotionKeywords[bestMatch];
    const confidence = bestScore > 0 ? Math.min(1, bestScore * 0.3) : 0.2;

    return {
      valence: matched.valence,
      arousal: matched.arousal,
      dominantEmotion: bestMatch,
      confidence,
    };
  }

  private getEmotionLabel(valence: number, emotion: string): string {
    const labels: Record<string, string> = {
      happy: '心情愉快 😊',
      excited: '很兴奋 🎉',
      sad: '有些低落 😔',
      angry: '有些烦躁 😤',
      anxious: '有些焦虑 😰',
      grateful: '心怀感激 🙏',
      confused: '有些困惑 🤔',
      neutral: '平静 😌',
    };
    return labels[emotion] || '平静 😌';
  }

  private rowToRecord(row: any): EmotionRecord {
    return {
      id: row.id,
      userId: row.user_id,
      valence: row.valence,
      arousal: row.arousal,
      dominantEmotion: row.dominant_emotion,
      confidence: row.confidence,
      trigger: row.trigger_text,
      createdAt: row.created_at,
    };
  }
}

export const emotionService = new EmotionService();
