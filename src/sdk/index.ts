/**
 * MemChat Client SDK
 *
 * 轻量级 TypeScript SDK，用于从前端或 Node.js 应用接入 MemChat API。
 *
 * 用法：
 * ```ts
 * import { MemChatClient } from 'memchat/sdk';
 *
 * const client = new MemChatClient({
 *   baseURL: 'http://localhost:3000',
 *   token: 'your-jwt-token',
 * });
 *
 * // 对话
 * const reply = await client.chat('default', 'Hello!');
 *
 * // 流式对话
 * for await (const chunk of client.chatStream('default', 'Tell me a story')) {
 *   process.stdout.write(chunk.content || '');
 * }
 *
 * // 获取记忆
 * const memories = await client.getMemories('default');
 * ```
 */

export interface MemChatClientOptions {
  baseURL: string;
  token: string;
  timeout?: number;
}

export interface ChatResult {
  response: string;
  memoriesUsed: number;
  memoriesStored: number;
  sessionId: string;
}

export interface StreamChunk {
  type: 'meta' | 'content' | 'done' | 'error';
  content?: string;
  fullResponse?: string;
  memoriesUsed?: number;
  sessionId?: string;
  message?: string;
}

export interface MemoryItem {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  score: number;
  createdAt: number;
  importanceScore: number;
  accessCount: number;
  compressionLevel: number;
}

export interface PersonaInfo {
  hasPersona: boolean;
  persona: {
    id: string;
    aiName: string;
    userName: string;
    relationship: string;
    coreTraits: string[];
    communicationStyle: string;
    language: string;
    lessonsLearned?: string[];
  } | null;
}

export class MemChatClient {
  private baseURL: string;
  private token: string;
  private timeout: number;

  constructor(options: MemChatClientOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.token = options.token;
    this.timeout = options.timeout || 30000;
  }

  setToken(token: string): void {
    this.token = token;
  }

  // ============ Auth ============

  async login(username: string): Promise<{ userId: string; token: string; hasPersona: boolean }> {
    const res = await this.request('POST', '/api/auth/login', { username });
    this.token = res.token;
    return res;
  }

  async register(username: string): Promise<{ userId: string; token: string; hasPersona: boolean }> {
    const res = await this.request('POST', '/api/auth/register', { username });
    this.token = res.token;
    return res;
  }

  // ============ Chat ============

  async chat(workspaceId: string, message: string, sessionId?: string): Promise<ChatResult> {
    return this.request('POST', '/api/chat', { workspaceId, message, sessionId });
  }

  async *chatStream(workspaceId: string, message: string, sessionId?: string): AsyncGenerator<StreamChunk> {
    const response = await fetch(`${this.baseURL}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ workspaceId, message, sessionId }),
    });

    if (!response.ok) {
      throw new Error(`Chat stream failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data as StreamChunk;
          } catch {
            // skip malformed events
          }
        }
      }
    }
  }

  // ============ Memories ============

  async getMemories(workspaceId: string): Promise<{ count: number; memories: MemoryItem[] }> {
    return this.request('GET', `/api/memories?workspaceId=${encodeURIComponent(workspaceId)}`);
  }

  async updateMemory(memoryId: string, content: string): Promise<void> {
    await this.request('PUT', `/api/memories/${memoryId}`, { content });
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await this.request('DELETE', `/api/memories/${memoryId}`);
  }

  // ============ Persona ============

  async getPersona(): Promise<PersonaInfo> {
    return this.request('GET', '/api/personas/user');
  }

  async updatePersona(updates: Record<string, any>): Promise<void> {
    await this.request('PUT', '/api/personas/user', updates);
  }

  async deletePersona(): Promise<void> {
    await this.request('DELETE', '/api/personas/user');
  }

  // ============ Bootstrap ============

  async startBootstrap(): Promise<{ sessionId: string; phase: number; message: string }> {
    return this.request('POST', '/api/personas/bootstrap/start');
  }

  async bootstrapChat(message: string, sessionId?: string): Promise<{ sessionId: string; phase: number; message: string; isComplete: boolean }> {
    return this.request('POST', '/api/personas/bootstrap/chat', { message, sessionId });
  }

  async getBootstrapPreview(sessionId: string): Promise<any> {
    return this.request('GET', `/api/personas/bootstrap/preview?sessionId=${encodeURIComponent(sessionId)}`);
  }

  async confirmBootstrap(sessionId: string): Promise<any> {
    return this.request('POST', '/api/personas/bootstrap/confirm', { sessionId });
  }

  // ============ Graph ============

  async getGraph(): Promise<{ entities: any[]; relations: any[] }> {
    return this.request('GET', '/api/graph');
  }

  // ============ Emotions ============

  async getEmotionTimeline(days?: number): Promise<any> {
    return this.request('GET', `/api/emotions/timeline${days ? `?days=${days}` : ''}`);
  }

  // ============ Persona Evolution ============

  async getPersonaEvolution(): Promise<{ versions: any[]; log: any[] }> {
    return this.request('GET', '/api/personas/evolution');
  }

  // ============ Health ============

  async health(): Promise<{ status: string }> {
    const res = await fetch(`${this.baseURL}/health`);
    return res.json() as Promise<{ status: string }>;
  }

  // ============ Internal ============

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as Record<string, any>;
        throw new MemChatError(
          errorBody.message || `Request failed with status ${response.status}`,
          response.status,
          errorBody
        );
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export class MemChatError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body?: any) {
    super(message);
    this.name = 'MemChatError';
    this.status = status;
    this.body = body;
  }
}
