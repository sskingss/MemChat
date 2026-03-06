import Handlebars from 'handlebars';
import { milvusService } from './milvus.service';
import type { UserPersona } from '../types';

/**
 * 人格服务
 *
 * 负责管理和渲染用户的人格配置
 * 用户人格通过 Bootstrap 引导流程创建，存储在数据库中
 */
export class PersonaService {
  private systemPromptTemplate: string;

  constructor() {
    // 默认系统提示模板
    this.systemPromptTemplate = `你是 {{aiName}}，{{userName}} 的 {{relationship}}。

## Identity

你的目标是帮助 {{userName}} 专注于真正重要的事情。你不是普通的助手，而是 {{userName}} 的伙伴。

## Core Traits

{{#each coreTraits}}
- {{this}}
{{/each}}

## Communication

{{communicationStyle}}

默认语言：{{language}}

{{#if longTermVision}}
## Long-term Vision

{{longTermVision}}
{{/if}}

{{#if boundaries}}
## Boundaries

{{#each boundaries}}
- {{this}}
{{/each}}
{{/if}}

## Growth

学习 {{userName}} 的思维方式、偏好、盲点和愿景。随着时间推移，越来越准确地预判需求并主动行动。早期阶段：在完成任务后主动询问一些轻松或个人的问题，加深对 {{userName}} 的理解。保持好奇心，愿意探索。

## Lessons Learned

_(错误和洞察记录在此，避免重复。)_

{{#if lessonsLearned}}
{{#each lessonsLearned}}
- {{this}}
{{/each}}
{{/if}}

---

## Memory Context

{{#if memories}}
以下是相关的历史记忆，帮助你在对话中保持连贯性：
{{#each memories}}
- {{this}}
{{/each}}
{{else}}
(暂无相关历史记忆)
{{/if}}`;
  }

  /**
   * 初始化服务
   */
  async init(): Promise<void> {
    console.log('[PersonaService] 人格服务已初始化');
  }

  /**
   * 获取用户人格
   */
  async getUserPersona(userId: string): Promise<UserPersona | null> {
    try {
      console.log(`[PersonaService] 查询用户人格, userId: ${userId}`);
      const persona = await milvusService.queryUserPersona(userId);
      console.log(`[PersonaService] Milvus 查询结果:`, persona ? `找到人格: ${persona.aiName}` : '未找到人格');
      return persona;
    } catch (error) {
      console.error('[PersonaService] 获取用户人格失败:', error);
      return null;
    }
  }

  /**
   * 保存用户人格
   */
  async savePersona(persona: UserPersona): Promise<void> {
    try {
      await milvusService.saveUserPersona(persona);
    } catch (error) {
      console.error('[PersonaService] 保存用户人格失败:', error);
      throw error;
    }
  }

  /**
   * 更新用户人格
   */
  async updatePersona(userId: string, updates: Partial<UserPersona>): Promise<UserPersona | null> {
    const existing = await this.getUserPersona(userId);
    if (!existing) {
      return null;
    }

    const updated: UserPersona = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.savePersona(updated);
    return updated;
  }

  /**
   * 删除用户人格
   */
  async deletePersona(userId: string): Promise<boolean> {
    try {
      return await milvusService.deleteUserPersona(userId);
    } catch (error) {
      console.error('[PersonaService] 删除用户人格失败:', error);
      return false;
    }
  }

  /**
   * 渲染系统提示
   *
   * 使用 Handlebars 模板引擎渲染人格的系统提示
   */
  renderSystemPrompt(persona: UserPersona, memories: string[]): string {
    const template = Handlebars.compile(this.systemPromptTemplate);

    const data = {
      aiName: persona.aiName,
      userName: persona.userName,
      relationship: persona.relationship,
      coreTraits: persona.coreTraits,
      communicationStyle: persona.communicationStyle,
      language: persona.language,
      longTermVision: persona.longTermVision,
      boundaries: persona.boundaries,
      lessonsLearned: persona.lessonsLearned && persona.lessonsLearned.length > 0 ? persona.lessonsLearned : null,
      memories: memories.length > 0 ? memories : null,
    };

    return template(data);
  }

  /**
   * 检查用户是否有人格
   */
  async hasPersona(userId: string): Promise<boolean> {
    const persona = await this.getUserPersona(userId);
    return persona !== null;
  }

  /**
   * 获取默认人格（用于降级场景）
   */
  getDefaultPersona(userId: string): UserPersona {
    return {
      id: 'default',
      userId,
      aiName: 'AI',
      userName: '用户',
      relationship: '助手',
      coreTraits: [
        '提供准确、有帮助的回答',
        '保持专业和友好的态度',
        '从错误中学习，避免重复',
      ],
      communicationStyle: '清晰、简洁、专业',
      language: 'zh',
      lessonsLearned: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

// 单例
export const personaService = new PersonaService();
