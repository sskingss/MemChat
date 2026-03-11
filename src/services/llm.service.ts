import OpenAI from 'openai';
import { config } from '../config';
import { LLMError } from '../utils/errors';
import { personaService } from './persona.service';
import { getRichTimeContext } from '../utils/time';
import type { MemoryImportanceResult, UserPersona, SimilarMemoryContext, MemoryUpdateDecision } from '../types';

/**
 * LLM 服务
 *
 * 使用 OpenAI 兼容 API 进行对话和记忆重要性判断
 */
export class LLMService {
  private openai: OpenAI;
  private model: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.llm.apiKey || 'no-key', // 私有模型可能不需要 key
      baseURL: config.llm.baseURL,
    });
    this.model = config.llm.model;
  }

  /**
   * 核心对话接口
   *
   * @param userId 用户 ID（用于获取人格）
   * @param userMessage 用户消息
   * @param context RAG 上下文（历史记忆，带时间戳）
   * @returns AI 回复
   */
  async chat(userId: string, userMessage: string, context: Array<{ content: string; createdAt: number }>): Promise<string> {
    try {
      // 获取用户人格
      let persona = await personaService.getUserPersona(userId);

      // 如果用户没有人格，使用默认人格
      if (!persona) {
        persona = personaService.getDefaultPersona(userId);
      }

      // 构建人格化系统提示
      const systemPrompt = this.buildPersonaPrompt(persona, context);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
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
   * 判断对话信息是否值得存储为长期记忆
   *
   * @param userMessage 用户消息
   * @param assistantReply AI 回复
   * @returns 是否重要，以及摘要和原因
   */
  async evaluateMemoryImportance(
    userMessage: string,
    assistantReply: string
  ): Promise<MemoryImportanceResult> {
    try {
      // 获取丰富的时间上下文
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

## 普通记忆规则

- 摘要应简洁但包含必要的上下文信息
- 如果涉及时间相关内容，同样使用绝对日期

如果只是简单的问答、临时性问题、或者不包含个人化信息，则不需要存储。

请以 JSON 格式返回判断结果：
{
  "isImportant": true/false,
  "summary": "重要信息的摘要（必须使用绝对日期，如：用户2024年3月15日周五14:00有周会，需要准备周报）",
  "reason": "判断为重要/不重要的原因",
  "memoryType": "general" | "todo",
  "expiresAt": 过期时间戳（毫秒，0表示永不过期，todo类型建议设置具体过期时间）
}

只返回 JSON，不要包含其他内容。`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new LLMError('记忆重要性判断返回格式异常');
      }

      // 解析 JSON
      const result = JSON.parse(content) as MemoryImportanceResult;

      // 确保 memoryType 和 expiresAt 有默认值
      if (!result.memoryType) {
        result.memoryType = 'general';
      }
      if (result.expiresAt === undefined) {
        result.expiresAt = 0;
      }

      console.log(`[LLM] 记忆判断: type=${result.memoryType}, summary=${result.summary?.substring(0, 50)}...`);

      return result;
    } catch (error) {
      // 如果判断失败，默认不存储（fail-safe）
      console.error('记忆重要性判断失败:', error);
      return {
        isImportant: false,
        reason: '判断过程出错',
      };
    }
  }

  /**
   * 判断新记忆是否需要与已有记忆合并/更新
   *
   * @param newSummary 新记忆摘要
   * @param similarMemories 相似的已有记忆列表
   * @returns 更新决策（create/update/merge）
   */
  async evaluateMemoryUpdate(
    newSummary: string,
    similarMemories: SimilarMemoryContext[]
  ): Promise<MemoryUpdateDecision> {
    // 如果没有相似记忆，直接创建
    if (similarMemories.length === 0) {
      return {
        action: 'create',
        reason: '没有找到相似记忆',
        newContent: newSummary,
      };
    }

    const prompt = `你是一个记忆管理助手。请分析新的记忆摘要是否需要与已有的相似记忆合并或更新。

【新的记忆摘要】
${newSummary}

【已有的相似记忆】
${similarMemories.map((m, i) => `[${i + 1}] ID: ${m.id}
内容: ${m.content}
相似度: ${(1 - m.score / 10).toFixed(2)}`).join('\n\n')}

请判断：
1. 新记忆与已有记忆是否属于"同一主题"？
2. 如果是同一主题，应该：
   - UPDATE: 更新某条记忆（如补充新信息、修正错误）
   - MERGE: 合并多条记忆（如果信息分散在多条记忆中）
   - CREATE: 创建新记忆（虽然主题相似但信息不同）

判断标准：
- 同一主题：讨论同一件事、同一个人、同一个偏好设置等
- 需要UPDATE：新信息补充或修正了已有记忆
- 需要MERGE：多条记忆讨论同一件事，但信息分散
- 需要CREATE：主题相关但信息独立，不应合并

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
      if (!content) {
        throw new LLMError('记忆更新判断返回格式异常');
      }

      const result = JSON.parse(content) as MemoryUpdateDecision;
      console.log(`[LLM] 记忆更新决策: ${result.action}, 原因: ${result.reason}`);
      return result;
    } catch (error) {
      console.error('[LLM] 记忆更新判断失败:', error);
      // Fail-safe: 默认创建新记忆
      return {
        action: 'create',
        reason: '判断过程出错，默认创建新记忆',
        newContent: newSummary,
      };
    }
  }

  /**
   * 构建人格化系统提示
   *
   * 使用人格模板渲染
   */
  private buildPersonaPrompt(persona: UserPersona, memories: Array<{ content: string; createdAt: number }>): string {
    return personaService.renderSystemPrompt(persona, memories);
  }
}

export const llmService = new LLMService();
