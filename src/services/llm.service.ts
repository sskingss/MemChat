import OpenAI from 'openai';
import { config } from '../config';
import { LLMError } from '../utils/errors';
import type { MemoryImportanceResult } from '../types';

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
   * @param userMessage 用户消息
   * @param context RAG 上下文（历史记忆）
   * @returns AI 回复
   */
  async chat(userMessage: string, context: string[]): Promise<string> {
    try {
      const systemPrompt = this.buildSystemPrompt(context);

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
      const prompt = `你是一个记忆重要性判断助手。请分析以下对话，判断是否包含值得长期存储的重要信息。

对话内容：
用户: ${userMessage}
助手: ${assistantReply}

判断标准：
1. 是否包含用户的个人偏好、习惯、重要背景信息？
2. 是否包含重要的决策或约定？
3. 是否包含需要在未来对话中记住的事实信息？
4. 是否包含用户的情感状态或重要经历？

如果只是简单的问答、临时性问题、或者不包含个人化信息，则不需要存储。

请以 JSON 格式返回判断结果：
{
  "isImportant": true/false,
  "summary": "重要信息的简短摘要（如果 isImportant 为 true）",
  "reason": "判断为重要/不重要的原因"
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
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new LLMError('记忆重要性判断返回格式异常');
      }

      // 解析 JSON
      const result = JSON.parse(content) as MemoryImportanceResult;

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
   * 构建 System Prompt
   *
   * 将历史记忆注入到上下文中
   */
  private buildSystemPrompt(context: string[]): string {
    if (context.length === 0) {
      return `你是一个有帮助的 AI 助手。请根据用户的提问提供准确、有帮助的回答。`;
    }

    const contextText = context.map((mem, idx) => `${idx + 1}. ${mem}`).join('\n');

    return `你是一个有帮助的 AI 助手。

以下是关于用户的长期记忆，请在回答时参考这些信息：
${contextText}

请根据用户的提问提供准确、有帮助的回答，并自然地利用这些记忆来个性化你的回复。`;
  }
}

export const llmService = new LLMService();
