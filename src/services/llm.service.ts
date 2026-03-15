import OpenAI from 'openai';
import { config } from '../config';
import { LLMError } from '../utils/errors';
import { personaService } from './persona.service';
import { getRichTimeContext } from '../utils/time';
import type {
  MemoryImportanceResult,
  UserPersona,
  SimilarMemoryContext,
  MemoryUpdateDecision,
  MemoryPipelineResult,
  WorkingMemoryMessage,
} from '../types';

/**
 * LLM 服务
 *
 * 使用 OpenAI 兼容 API 进行对话和记忆处理
 *
 * 【性能优化】processMemoryPipeline：
 * 将原来两次串行 LLM 调用（重要性评估 + 更新决策）合并为一次调用，
 * 同时支持批量提取多条事实，大幅降低延迟和 token 消耗。
 */
export class LLMService {
  private openai: OpenAI;
  private model: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.llm.apiKey || 'no-key',
      baseURL: config.llm.baseURL,
    });
    this.model = config.llm.model;
  }

  /**
   * 核心对话接口
   *
   * @param userId           用户 ID（用于获取人格）
   * @param userMessage      用户消息
   * @param context          长期记忆 RAG 上下文
   * @param sessionMessages  会话级 working memory（最近几轮对话）
   */
  async chat(
    userId: string,
    userMessage: string,
    context: Array<{ content: string; createdAt: number }>,
    sessionMessages?: WorkingMemoryMessage[]
  ): Promise<string> {
    try {
      let persona = await personaService.getUserPersona(userId);
      if (!persona) {
        persona = personaService.getDefaultPersona(userId);
      }

      const systemPrompt = this.buildPersonaPrompt(persona, context);

      // 构建消息列表：系统提示 + 历史会话（working memory）+ 当前消息
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
      ];

      // 注入会话历史（working memory），让 LLM 感知多轮上下文
      if (sessionMessages && sessionMessages.length > 0) {
        for (const msg of sessionMessages) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      messages.push({ role: 'user', content: userMessage });

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new LLMError('LLM 返回格式异常');
      }

      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new LLMError(`LLM 调用失败: ${message}`);
    }
  }

  /**
   * 流式对话接口
   *
   * 返回 OpenAI Stream 对象，供 SSE 端点使用
   */
  async chatStream(
    userId: string,
    userMessage: string,
    context: Array<{ content: string; createdAt: number }>,
    sessionMessages?: WorkingMemoryMessage[]
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    let persona = await personaService.getUserPersona(userId);
    if (!persona) {
      persona = personaService.getDefaultPersona(userId);
    }

    const systemPrompt = this.buildPersonaPrompt(persona, context);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (sessionMessages && sessionMessages.length > 0) {
      for (const msg of sessionMessages) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: userMessage });

    const stream = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 4096,
      stream: true,
    });

    return stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  }

  /**
   * 【核心优化】记忆处理 Pipeline — 单次 LLM 调用完成所有记忆决策
   *
   * 替代原来的两步流程（evaluateMemoryImportance + evaluateMemoryUpdate），
   * 一次性完成：
   * 1. 从对话中提取所有重要事实（支持多条）
   * 2. 为每条事实分配认知分类（semantic/episodic/procedural/todo）
   * 3. 与已有相似记忆对比，决定 create/update/merge/skip
   *
   * 性能收益：
   * - LLM 调用次数：2次 → 1次（节省约 50% 延迟）
   * - 嵌入计算：复用 RAG 阶段已生成的向量（命中缓存）
   */
  async processMemoryPipeline(
    userMessage: string,
    assistantReply: string,
    existingMemories: SimilarMemoryContext[]
  ): Promise<MemoryPipelineResult> {
    const timeContext = getRichTimeContext();

    const existingMemoriesText = existingMemories.length > 0
      ? existingMemories.map((m, i) =>
          `[${i + 1}] ID: ${m.id}\n内容: ${m.content}\n相似度: ${(1 - m.score / 2).toFixed(2)}`
        ).join('\n\n')
      : '（无相似记忆）';

    const prompt = `你是一个精准的记忆提取助手，负责从对话中提取值得长期存储的事实。

## 当前时间
${timeContext.formattedContext}

## 对话内容
用户: ${userMessage}
助手: ${assistantReply}

## 潜在相关的已有记忆
${existingMemoriesText}

## 记忆认知分类
- semantic:   关于用户的稳定事实（偏好、技能、背景、价值观）
- episodic:   具体发生过的事件（会议、经历、决策）
- procedural: 行为习惯与模式（做事方式）
- todo:       待办事项、提醒、截止日期

## 重要性评分标准（1-10）
- 9-10: 核心身份信息（姓名、职业、重大人生事件、深层价值观）
- 7-8:  重要偏好、关键决策、持续有效的承诺
- 5-6:  一般背景信息、日常待办、普通经历
- 3-4:  补充细节、一次性信息
- 1-2:  几乎无长期价值的琐碎内容

## 存储动作规则
对每条提取的事实，选择一个动作：
- create: 新信息，已有记忆中不存在
- update: 补充或修正某条已有记忆（需指定 targetMemoryId）
- merge:  将多条相关记忆合并为一条（需指定 targetMemoryIds 数组）
- skip:   信息已被覆盖，或不值得存储

## 时间规则
- 使用绝对日期，不用"明天""下周"等相对时间
- 今天: ${timeContext.currentDate}，明天: ${timeContext.tomorrow}，下周一: ${timeContext.nextMonday}
- todo 类型需设置 expiresAt（截止日期的毫秒时间戳）
- 其他类型 expiresAt 设为 0（永不过期）

## 输出要求
只返回合法 JSON，格式如下：
{
  "facts": [
    {
      "content": "简洁的事实摘要",
      "category": "semantic|episodic|procedural|todo",
      "importanceScore": 1到10的整数,
      "expiresAt": 0,
      "action": "create|update|merge|skip",
      "targetMemoryId": null,
      "targetMemoryIds": null,
      "actionContent": "实际存入的内容（如与 content 不同，例如 update/merge 后的合并内容）"
    }
  ]
}

如果没有值得存储的信息，返回 {"facts": []}。
只返回 JSON，不包含任何其他内容。`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new LLMError('记忆 Pipeline 返回格式异常');
      }

      const result = JSON.parse(content) as MemoryPipelineResult;

      if (!Array.isArray(result.facts)) {
        result.facts = [];
      }

      // 规范化每条 fact
      result.facts = result.facts.map(fact => ({
        ...fact,
        importanceScore: Math.max(1, Math.min(10, fact.importanceScore || 5)),
        expiresAt: fact.expiresAt ?? 0,
        action: fact.action || 'create',
        targetMemoryId: fact.targetMemoryId || null,
        targetMemoryIds: fact.targetMemoryIds || null,
        actionContent: fact.actionContent || null,
      }));

      const actionable = result.facts.filter(f => f.action !== 'skip');
      console.log(`[LLM] Pipeline 提取 ${result.facts.length} 条事实，其中 ${actionable.length} 条需要处理`);

      return result;
    } catch (error) {
      console.error('[LLM] 记忆 Pipeline 失败:', error);
      return { facts: [] };
    }
  }

  /**
   * 判断对话信息是否值得存储为长期记忆（旧版，保留向后兼容）
   */
  async evaluateMemoryImportance(
    userMessage: string,
    assistantReply: string
  ): Promise<MemoryImportanceResult> {
    try {
      const timeContext = getRichTimeContext();

      const prompt = `你是一个记忆重要性判断助手。请分析以下对话，判断是否包含值得长期存储的重要信息。

## 当前时间上下文

${timeContext.formattedContext}

## 对话内容

用户: ${userMessage}
助手: ${assistantReply}

## 判断标准

1. 是否包含用户的个人偏好、习惯、重要背景信息？
2. 是否包含重要的决策或约定？
3. 是否包含需要在未来对话中记住的事实信息？
4. 是否包含用户的情感状态或重要经历？
5. 是否包含待办事项、任务、提醒或截止日期？

## 待办事项识别规则

- 如果对话包含任务、待办、提醒、截止日期等，应标记为 todo 类型
- **关键：摘要必须使用绝对日期而非相对时间**
  - 正确示例："用户2024年3月15日周五有周会"
  - 错误示例："用户明天有周会"
- 根据上方时间上下文，将相对时间转换为绝对日期：
  - "今天" → ${timeContext.currentDate}
  - "明天" → ${timeContext.tomorrow}
  - "后天" → ${timeContext.dayAfterTomorrow}
  - "下周一" → ${timeContext.nextMonday}
- 提取具体的时间点（如"下午3点"转为"15:00"）
- expiresAt 应该是任务完成或过期的时间戳（毫秒）

## 重要性评分标准（importanceScore 1-10）

- 9-10：核心身份信息（姓名、职业、重大人生事件、深层价值观）
- 7-8：重要偏好、关键决策、重要约定、持续有效的习惯
- 5-6：一般性背景信息、日常待办、普通经历
- 3-4：补充细节、一次性信息
- 1-2：几乎没有长期价值的琐碎内容

如果只是简单的问答、临时性问题、或者不包含个人化信息，则不需要存储。

请以 JSON 格式返回判断结果：
{
  "isImportant": true/false,
  "summary": "重要信息的摘要",
  "reason": "判断为重要/不重要的原因",
  "memoryType": "general" | "todo",
  "expiresAt": 过期时间戳（毫秒，0表示永不过期）,
  "importanceScore": 重要性分值（1-10的整数）
}

只返回 JSON，不要包含其他内容。`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new LLMError('记忆重要性判断返回格式异常');
      }

      const result = JSON.parse(content) as MemoryImportanceResult;

      if (!result.memoryType) result.memoryType = 'general';
      if (result.expiresAt === undefined) result.expiresAt = 0;
      if (!result.importanceScore || result.importanceScore < 1 || result.importanceScore > 10) {
        result.importanceScore = 5;
      }

      return result;
    } catch (error) {
      console.error('记忆重要性判断失败:', error);
      return { isImportant: false, reason: '判断过程出错' };
    }
  }

  /**
   * 判断新记忆是否需要与已有记忆合并/更新（旧版，保留向后兼容）
   */
  async evaluateMemoryUpdate(
    newSummary: string,
    similarMemories: SimilarMemoryContext[]
  ): Promise<MemoryUpdateDecision> {
    if (similarMemories.length === 0) {
      return { action: 'create', reason: '没有找到相似记忆', newContent: newSummary };
    }

    const prompt = `你是一个记忆管理助手。请分析新的记忆摘要是否需要与已有的相似记忆合并或更新。

【新的记忆摘要】
${newSummary}

【已有的相似记忆】
${similarMemories.map((m, i) => `[${i + 1}] ID: ${m.id}\n内容: ${m.content}\n相似度: ${(1 - m.score / 10).toFixed(2)}`).join('\n\n')}

请以 JSON 格式返回：
{
  "action": "create" | "update" | "merge",
  "reason": "判断原因",
  "targetMemoryId": "需要更新的记忆ID（action=update时）",
  "targetMemoryIds": ["需要合并的记忆ID数组（action=merge时）"],
  "updatedContent": "更新后的内容（action=update时）",
  "mergedContent": "合并后的内容（action=merge时）",
  "newContent": "新记忆内容（action=create时）"
}

只返回 JSON，不要包含其他内容。`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new LLMError('记忆更新判断返回格式异常');

      return JSON.parse(content) as MemoryUpdateDecision;
    } catch (error) {
      console.error('[LLM] 记忆更新判断失败:', error);
      return { action: 'create', reason: '判断过程出错，默认创建新记忆', newContent: newSummary };
    }
  }

  /**
   * 批量评估记忆的保留价值（用于清理阶段）
   */
  async evaluateMemoryRetention(
    memories: Array<{ id: string; content: string; createdAt: number }>
  ): Promise<Array<{ id: string; shouldKeep: boolean; reason: string }>> {
    if (memories.length === 0) return [];

    const timeContext = getRichTimeContext();

    const prompt = `你是一个记忆管理助手。请评估以下记忆的保留价值。

## 当前时间
${timeContext.formattedContext}

## 待评估的记忆
${memories.map((m, i) => `[${i + 1}] ID: ${m.id}\n创建时间: ${new Date(m.createdAt).toLocaleString('zh-CN')}\n内容: ${m.content}`).join('\n\n')}

## 评估标准

**应该保留** (shouldKeep: true)：
- 包含用户的长期偏好、习惯、性格特点
- 包含重要的人际关系信息
- 包含重要的历史事件或经历
- 包含持续有效的决策或约定

**可以删除** (shouldKeep: false)：
- 临时性、一次性的信息（如已完成的待办）
- 过时的信息（如过去的日程安排）
- 重复或冗余的信息
- 琐碎的日常细节，无长期参考价值
- 超过 30 天的 todo 类型记忆

请以 JSON 格式返回评估结果：
{"results": [{"id": "记忆ID", "shouldKeep": true/false, "reason": "原因"}]}

只返回 JSON，不要包含其他内容。`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new LLMError('记忆评估返回格式异常');

      const parsed = JSON.parse(content);
      const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.memories || []);

      return results.map((r: any) => ({
        id: r.id,
        shouldKeep: r.shouldKeep ?? true,
        reason: r.reason || '未提供原因',
      }));
    } catch (error) {
      console.error('[LLM] 记忆评估失败:', error);
      return memories.map(m => ({ id: m.id, shouldKeep: true, reason: '评估失败，默认保留' }));
    }
  }

  /**
   * 对一组语义相近的记忆簇进行压缩，生成统一摘要
   */
  async compressMemoryCluster(
    memories: Array<{ id: string; content: string; createdAt: number; importanceScore: number }>
  ): Promise<{ summary: string; importanceScore: number }> {
    if (memories.length === 0) throw new LLMError('compressMemoryCluster: 记忆列表为空');
    if (memories.length === 1) {
      return { summary: memories[0].content, importanceScore: memories[0].importanceScore };
    }

    const timeContext = getRichTimeContext();
    const maxScore = Math.max(...memories.map(m => m.importanceScore));

    const prompt = `你是一个记忆压缩助手。以下是关于同一主题的多条记忆，请将它们压缩为一条完整、简洁的摘要记忆，保留所有关键信息，去除重复内容。

## 当前时间
${timeContext.formattedContext}

## 待压缩的记忆（共 ${memories.length} 条）

${memories.map((m, i) => `[${i + 1}] 创建时间: ${new Date(m.createdAt).toLocaleString('zh-CN')}\n重要性: ${m.importanceScore}/10\n内容: ${m.content}`).join('\n\n')}

## 压缩要求

1. 综合所有记忆，生成一条包含全部关键信息的摘要
2. 去除重复、矛盾或过时的部分（保留最新版本）
3. 摘要应简洁但完整，不超过 500 字
4. 时间信息统一使用绝对日期格式
5. 给出压缩后记忆的重要性分值（1-10），不低于原始最高分值 ${maxScore}

请以 JSON 格式返回：
{"summary": "压缩后的记忆摘要", "importanceScore": 分值}

只返回 JSON，不要包含其他内容。`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new LLMError('记忆压缩返回格式异常');

      const result = JSON.parse(content) as { summary: string; importanceScore: number };
      if (!result.summary) throw new LLMError('压缩摘要为空');
      if (!result.importanceScore || result.importanceScore < 1 || result.importanceScore > 10) {
        result.importanceScore = maxScore;
      }

      console.log(`[LLM] 压缩 ${memories.length} 条记忆 → score=${result.importanceScore}`);
      return result;
    } catch (error) {
      console.error('[LLM] 记忆压缩失败:', error);
      const fallbackSummary = memories.map(m => m.content).join(' | ');
      return { summary: fallbackSummary.substring(0, 1900), importanceScore: maxScore };
    }
  }

  /**
   * 构建人格化系统提示
   */
  private buildPersonaPrompt(persona: UserPersona, memories: Array<{ content: string; createdAt: number }>): string {
    return personaService.renderSystemPrompt(persona, memories);
  }
}

export const llmService = new LLMService();
