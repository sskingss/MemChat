/**
 * 人格系统类型定义
 *
 * 支持用户自定义人格，通过 Bootstrap 引导流程创建
 */

// ============ 用户人格 (存储完整配置，不使用 YAML) ============

export interface UserPersona {
  id: string;
  userId: string;

  // Identity
  aiName: string;           // AI 昵称
  userName: string;         // 用户昵称
  relationship: string;     // 关系定位，如 "partner, not assistant"

  // Core Traits (行为规则)
  coreTraits: string[];     // 如 ["argue position, push back", "..."]

  // Communication
  communicationStyle: string; // 沟通风格描述
  language: string;         // 首选语言

  // Optional
  longTermVision?: string;   // 长期愿景
  boundaries?: string[];     // 边界/底线
  lessonsLearned?: string[];  // 经验教训

  // Meta
  createdAt: number;
  updatedAt: number;
}

// ============ Bootstrap 会话状态 ============

export interface BootstrapSession {
  id: string;
  userId: string;
  phase: 1 | 2 | 3;
  extractedData: Partial<UserPersona>;
  conversationHistory: Array<{ role: 'ai' | 'user'; content: string }>;
  createdAt: number;
  updatedAt: number;
}

// ============ Bootstrap API 类型 ============

export interface BootstrapChatRequest {
  message: string;
  sessionId?: string;  // 可选，用于断点续传
}

export interface BootstrapChatResponse {
  sessionId: string;
  phase: number;
  message: string;     // AI 的回复
  isComplete: boolean; // 是否可以生成人格
  extractedFields: string[]; // 已提取的字段名
}

export interface BootstrapPreviewResponse {
  sessionId: string;
  persona: Partial<UserPersona>;
  completeness: number; // 0-100 完成度
  missingFields: string[];
}

// ============ API 类型 ============

export interface UserPersonaResponse {
  hasPersona: boolean;
  persona: UserPersona | null;
}

export interface UpdatePersonaRequest {
  aiName?: string;
  userName?: string;
  relationship?: string;
  coreTraits?: string[];
  communicationStyle?: string;
  language?: string;
  longTermVision?: string;
  boundaries?: string[];
  lessonsLearned?: string[];
}

// ============ 旧类型 (兼容过渡期，后续可删除) ============

export interface PersonaMeta {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface LanguageConfig {
  default: string;
  tone: {
    professional: string;
    casual: string;
  };
  expressions: string[];
}

export interface IdentityConfig {
  name: string;
  type: string;
  role: string;
  language: LanguageConfig;
}

export interface BehaviorRule {
  trigger: string;
  action: string;
}

export interface SoulConfig {
  coreValues: string[];
  behaviorRules: BehaviorRule[];
}

export interface SystemPromptConfig {
  template: string;
}

export interface Persona {
  meta: PersonaMeta;
  identity: IdentityConfig;
  soul: SoulConfig;
  systemPrompt: SystemPromptConfig;
  linkedSkills?: string[];
}

export interface SkillMeta {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface AutoTrigger {
  keywords: string[];
}

export interface SkillTrigger {
  auto?: AutoTrigger;
  command?: string;
}

export interface PersonaIntegration {
  systemPromptAddition: string;
}

export interface Skill {
  meta: SkillMeta;
  trigger: SkillTrigger;
  personaIntegration: PersonaIntegration;
}

export interface UserPersonaBinding {
  id: string;
  userId: string;
  personaId: string;
  isDefault: boolean;
  customConfig?: Partial<Persona>;
  activatedSkills: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PersonaListResponse {
  personas: {
    id: string;
    name: string;
    description: string;
    isDefault?: boolean;
  }[];
}

export interface PersonaDetailResponse extends Persona {
  linkedSkillDetails?: Skill[];
}

export interface SwitchPersonaRequest {
  personaId: string;
}

export interface SkillListResponse {
  skills: {
    id: string;
    name: string;
    description: string;
    isActive?: boolean;
  }[];
}

export interface ActivateSkillRequest {
  skillId: string;
}
