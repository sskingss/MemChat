import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { milvusService } from './milvus.service';
import type {
  BootstrapSession,
  BootstrapChatResponse,
  BootstrapPreviewResponse,
  UserPersona,
} from '../types';

// 阶段配置
interface PhaseConfig {
  name: string;
  goal: string;
  focusFields: string[];
}

const PHASE_CONFIGS: Record<number, PhaseConfig> = {
  1: {
    name: 'Hello',
    goal: '确定交流语言',
    focusFields: ['language'],
  },
  2: {
    name: 'You',
    goal: '了解用户身份，确定 AI 昵称、用户昵称和关系定位',
    focusFields: ['userName', 'aiName', 'relationship'],
  },
  3: {
    name: 'Personality',
    goal: '定义 AI 的核心特质和沟通风格',
    focusFields: ['coreTraits', 'communicationStyle'],
  },
};

// 必填字段
const REQUIRED_FIELDS: (keyof UserPersona)[] = [
  'aiName',
  'userName',
  'relationship',
  'coreTraits',
  'communicationStyle',
  'language',
];

/**
 * 人格引导服务
 *
 * 通过 4 阶段交互式对话，引导用户创建自定义人格
 */
export class PersonaBootstrapService {
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
   * 开始新的引导会话
   */
  async startSession(userId: string): Promise<BootstrapSession> {
    // 检查是否有未完成的会话
    const existingSession = await milvusService.getLatestBootstrapSession(userId);
    if (existingSession && existingSession.phase <= 3) {
      return existingSession;
    }

    // 生成开场白
    const greeting = `Hi! 你好！👋

欢迎来到人格创建向导。让我们一起打造一个真正适合你的 AI 伙伴。

首先，我们用什么语言交流呢？ (中文 / English)`;

    // 创建新会话
    const session: BootstrapSession = {
      id: uuidv4(),
      userId,
      phase: 1,
      extractedData: {},
      conversationHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 添加开场白到对话历史
    session.conversationHistory.push({
      role: 'ai',
      content: greeting,
    });

    await milvusService.updateBootstrapSession(session);

    return session;
  }

  /**
   * 处理用户消息
   */
  async chat(userId: string, message: string, sessionId?: string): Promise<BootstrapChatResponse> {
    // 获取或创建会话
    let session: BootstrapSession | undefined;

    // 尝试用 sessionId 获取会话，如果失败则回退到获取最新会话
    if (sessionId) {
      const existing = await milvusService.getBootstrapSession(sessionId, userId);
      if (existing) {
        session = existing;
      }
      // 找不到不报错，回退到获取最新会话
    }

    // 没有 session 则尝试获取该用户最新的会话
    if (!session) {
      const existing = await milvusService.getLatestBootstrapSession(userId);
      if (existing) {
        session = existing;
      }
    }

    // 还是没有则创建新会话
    if (!session) {
      session = await this.startSession(userId);
    }

    // 添加用户消息到历史
    session.conversationHistory.push({
      role: 'user',
      content: message,
    });

    // 使用 LLM 处理并提取信息
    const { response, extractedData, shouldAdvance } = await this.processWithLLM(session, message);

    // 合并提取的数据
    session.extractedData = {
      ...session.extractedData,
      ...extractedData,
    };

    // 智能判断是否应该进入下一阶段：当前阶段的所有字段都已提取
    const shouldAdvancePhase = this.shouldAdvanceToNextPhase(session);

    // 如果应该进入下一阶段，更新阶段
    if (shouldAdvancePhase && session.phase < 3) {
      session.phase = (session.phase + 1) as 1 | 2 | 3;
    }

    // 添加 AI 回复到历史
    session.conversationHistory.push({
      role: 'ai',
      content: response,
    });

    // 更新时间戳
    session.updatedAt = Date.now();

    // 更新会话
    await milvusService.updateBootstrapSession(session);

    // 计算已提取的字段
    const extractedFields = Object.keys(session.extractedData).filter(
      key => {
        const value = session.extractedData[key as keyof UserPersona];
        return value !== undefined && value !== '' &&
          !(Array.isArray(value) && value.length === 0);
      }
    );

    // 判断是否完成
    const isComplete = this.isSessionComplete(session);

    return {
      sessionId: session.id,
      phase: session.phase,
      message: response,
      isComplete,
      extractedFields,
    };
  }

  /**
   * 获取人格预览
   */
  async getPreview(sessionId: string, userId: string): Promise<BootstrapPreviewResponse> {
    // 先尝试用 sessionId 获取，找不到则用最新会话
    let session = await milvusService.getBootstrapSession(sessionId, userId);
    if (!session) {
      session = await milvusService.getLatestBootstrapSession(userId);
    }
    if (!session) {
      throw new Error('会话不存在，请重新开始创建人格');
    }

    const { completeness, missingFields } = this.calculateCompleteness(session.extractedData);

    return {
      sessionId: session.id,
      persona: session.extractedData,
      completeness,
      missingFields,
    };
  }

  /**
   * 确认并保存人格
   */
  async confirmAndSave(sessionId: string, userId: string): Promise<UserPersona> {
    // 先尝试用 sessionId 获取，找不到则用最新会话
    let session = await milvusService.getBootstrapSession(sessionId, userId);
    if (!session) {
      session = await milvusService.getLatestBootstrapSession(userId);
    }
    if (!session) {
      throw new Error('会话不存在，请重新开始创建人格');
    }

    if (!this.isSessionComplete(session)) {
      throw new Error('信息不完整，无法创建人格');
    }

    // 创建完整的人格对象
    const persona: UserPersona = {
      id: uuidv4(),
      userId,
      aiName: session.extractedData.aiName || 'AI',
      userName: session.extractedData.userName || 'testuser',
      relationship: session.extractedData.relationship || 'partner',
      coreTraits: session.extractedData.coreTraits || [],
      communicationStyle: session.extractedData.communicationStyle || '',
      language: session.extractedData.language || 'zh',
      lessonsLearned: session.extractedData.lessonsLearned || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 保存到数据库
    await milvusService.saveUserPersona(persona);

    // 验证保存是否成功
    const savedPersona = await milvusService.queryUserPersona(userId);
    if (!savedPersona) {
      throw new Error('人格保存失败：无法查询到已保存的数据');
    }
    console.log(`[BootstrapService] 人格保存成功，userId: ${userId}, aiName: ${savedPersona.aiName}`);

    // 清理引导会话
    await milvusService.deleteBootstrapSession(sessionId, userId);

    return savedPersona;
  }

  // ============ Private helper methods ============

  /**
   * 使用 LLM 处理对话并提取信息
   */
  private async processWithLLM(
    session: BootstrapSession,
    userMessage: string
  ): Promise<{
    response: string;
    extractedData: Partial<UserPersona>;
    shouldAdvance: boolean;
  }> {
    const phaseConfig = PHASE_CONFIGS[session.phase];

    // 计算当前阶段缺失的字段
    const missingInPhase = phaseConfig.focusFields.filter(
      field => {
        const value = session.extractedData[field as keyof UserPersona];
        return value === undefined || value === '' ||
          (Array.isArray(value) && value.length === 0);
      }
    );

    const systemPrompt = `你是一个温暖、专业的人格创建引导助手。你的任务是通过自然对话，逐步了解用户并提取信息来创建他们的专属 AI 人格。

【当前阶段】Phase ${session.phase} - ${phaseConfig.name}
【阶段目标】${phaseConfig.goal}
【本阶段需要提取的字段】${phaseConfig.focusFields.join(', ')}
【本阶段尚未提取的字段】${missingInPhase.length > 0 ? missingInPhase.join(', ') : '已全部提取'}

【已提取的信息】
${JSON.stringify(session.extractedData, null, 2)}

【对话原则】
1. 每次只问 1 个问题，等待用户回答
2. 真诚地回应用户，展现好奇心和共情
3. 用用户的原话来确认信息，而不是改写
4. 如果用户提供了相关信息，及时确认并记录
5. 继续询问本阶段尚未提取的字段，直到全部完成

【重要】输出格式必须是严格的 JSON 格式！输出示例：
{
  "response": "你的回复内容（记得在回复中问下一个问题）",
  "extractedData": {
    "aiName": "幂幂"
  }
}

【字段说明】
- language: 语言 (zh/en)
- aiName: AI 昵称（你应该如何称呼自己）
- userName: 用户昵称（你应该怎么称呼用户）
- relationship: 关系定位 (如 "partner", "assistant", "friend", "mentor" 等)
- coreTraits: 核心特质数组 (如 ["direct", "professional", "warm"])
- communicationStyle: 沟通风格描述（简洁详细、正式随意等）

【注意事项】
1. 只有当用户明确提供信息时才提取，不要猜测或假设
2. 如果用户只回答"中文"，只提取 language: "zh"，然后继续问下一个问题
3. 每次回复都要包含一个新问题，引导用户完成当前阶段
4. 不要一次性问多个问题`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `用户说: "${userMessage}"\n\n请分析用户输入，提取信息并给出回复（记得继续提问）。` },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const content = completion.choices[0]?.message?.content || '';

      // 尝试解析 JSON 响应
      try {
        // 提取 JSON 部分（处理可能的 markdown 代码块）
        let jsonContent = content;
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim();
        }

        const parsed = JSON.parse(jsonContent);
        const extractedData = this.normalizeExtractedData(parsed.extractedData || {});

        return {
          response: parsed.response || '好的，我明白了。',
          extractedData,
          shouldAdvance: false, // 不再依赖 LLM 判断，由 shouldAdvanceToNextPhase 决定
        };
      } catch {
        // JSON 解析失败，使用回退逻辑
        console.warn('[BootstrapService] JSON 解析失败，使用回退逻辑');
        const fallbackData = this.extractFallbackData(userMessage, session.phase);
        return {
          response: content || `好的，我记下了。${this.getNextQuestion(session.phase, missingInPhase)}`,
          extractedData: fallbackData,
          shouldAdvance: false,
        };
      }
    } catch (error) {
      console.error('[BootstrapService] LLM 处理失败:', error);
      const fallbackData = this.extractFallbackData(userMessage, session.phase);
      return {
        response: `好的，我记下了。${this.getNextQuestion(session.phase, missingInPhase)}`,
        extractedData: fallbackData,
        shouldAdvance: false,
      };
    }
  }

  /**
   * 规范化提取的数据
   */
  private normalizeExtractedData(data: Record<string, unknown>): Partial<UserPersona> {
    const normalized: Partial<UserPersona> = {};

    // 字段映射：处理可能的字段名变体
    const fieldMappings: Record<string, keyof UserPersona> = {
      'aiName': 'aiName',
      'ai_name': 'aiName',
      'userName': 'userName',
      'user_name': 'userName',
      'language': 'language',
      'relationship': 'relationship',
      'coreTraits': 'coreTraits',
      'core_traits': 'coreTraits',
      'communicationStyle': 'communicationStyle',
      'communication_style': 'communicationStyle',
      'longTermVision': 'longTermVision',
      'long_term_vision': 'longTermVision',
      'boundaries': 'boundaries',
      'lessonsLearned': 'lessonsLearned',
      'lessons_learned': 'lessonsLearned',
    };

    for (const [key, value] of Object.entries(data)) {
      const normalizedKey = fieldMappings[key] || (key as keyof UserPersona);

      // 跳过空值
      if (value === undefined || value === null || value === '') {
        continue;
      }

      // 处理数组类型
      if (normalizedKey === 'coreTraits' || normalizedKey === 'boundaries' || normalizedKey === 'lessonsLearned') {
        if (typeof value === 'string') {
          (normalized as Record<string, unknown>)[normalizedKey] = [value];
        } else if (Array.isArray(value)) {
          (normalized as Record<string, unknown>)[normalizedKey] = value;
        }
      } else if (typeof value === 'string') {
        (normalized as Record<string, unknown>)[normalizedKey] = value;
      }
    }

    return normalized;
  }

  /**
   * 判断是否应该进入下一阶段
   */
  private shouldAdvanceToNextPhase(session: BootstrapSession): boolean {
    const phaseConfig = PHASE_CONFIGS[session.phase];
    if (!phaseConfig) return false;

    // 检查当前阶段的所有字段是否都已提取
    for (const field of phaseConfig.focusFields) {
      const value = session.extractedData[field as keyof UserPersona];
      if (value === undefined || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
        return false; // 还有字段未提取
      }
    }

    return true; // 当前阶段所有字段都已提取
  }

  /**
   * 从用户消息中提取信息（回退逻辑）
   */
  private extractFallbackData(message: string, phase: number): Partial<UserPersona> {
    const data: Partial<UserPersona> = {};

    // 语言检测
    if (phase === 1) {
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('中文') || lowerMessage.includes('chinese') || lowerMessage === 'zh') {
        data.language = 'zh';
      } else if (lowerMessage.includes('english') || lowerMessage.includes('英语') || lowerMessage === 'en') {
        data.language = 'en';
      } else if (lowerMessage.includes('japanese') || lowerMessage.includes('日语') || lowerMessage === 'ja') {
        data.language = 'ja';
      }
    }

    return data;
  }

  /**
   * 获取下一个问题
   */
  private getNextQuestion(phase: number, missingFields: string[]): string {
    const questionMap: Record<string, string> = {
      'language': '我们用什么语言交流呢？(中文 / English)',
      'aiName': '你希望我怎么称呼自己呢？给我起个名字吧！',
      'userName': '那我应该怎么称呼你呢？',
      'relationship': '你希望我们是什么关系呢？比如伙伴、助手、朋友、导师...',
      'coreTraits': '你希望我具备哪些特质呢？比如直接坦诚、温暖体贴、专业严谨...',
      'communicationStyle': '你喜欢什么样的沟通风格？简洁直接还是详细周到？',
    };

    if (missingFields.length > 0) {
      return questionMap[missingFields[0]] || '还有什么想告诉我的吗？';
    }

    const phaseQuestions: Record<number, string> = {
      1: '请问你希望我怎么称呼你呢？',
      2: '你觉得我作为你的 AI 伙伴，应该具备哪些特质呢？',
      3: '在沟通方式上，你更喜欢什么样的风格？',
    };
    return phaseQuestions[phase] || '还有什么想告诉我的吗？';
  }

  /**
   * 判断会话是否完成
   */
  private isSessionComplete(session: BootstrapSession): boolean {
    const { completeness } = this.calculateCompleteness(session.extractedData);
    return completeness >= 100;
  }

  /**
   * 计算完成度
   */
  private calculateCompleteness(data: Partial<UserPersona>): {
    completeness: number;
    missingFields: string[];
  } {
    const missingFields: string[] = [];

    for (const field of REQUIRED_FIELDS) {
      const value = data[field];
      // 检查字段是否存在且有值
      if (value === undefined || value === null || value === '') {
        missingFields.push(field);
      } else if (Array.isArray(value) && value.length === 0) {
        missingFields.push(field);
      }
    }

    const completeness = Math.round(
      ((REQUIRED_FIELDS.length - missingFields.length) / REQUIRED_FIELDS.length) * 100
    );

    return { completeness, missingFields };
  }
}

// 导出单例
export const personaBootstrapService = new PersonaBootstrapService();
