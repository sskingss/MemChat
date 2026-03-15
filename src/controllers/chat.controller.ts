import { Request, Response, NextFunction } from 'express';
import { memoryService } from '../services/memory.service';
import { llmService } from '../services/llm.service';
import { workingMemoryService, WorkingMemoryService } from '../services/working-memory.service';
import { LLMError } from '../utils/errors';
import type { ChatRequest, ChatResponse, UserContext } from '../types';

/**
 * Chat Controller
 *
 * 核心对话接口：/api/chat
 *
 * 升级后的流程：
 * 1. 解析 sessionId（支持多轮会话管理）
 * 2. 从 Working Memory 获取会话历史（短期记忆）
 * 3. 从 Milvus 检索长期记忆（混合检索：向量 + 关键词 + 时间衰减）
 * 4. 调用 LLM（注入：长期记忆 + 会话历史 + 当前消息）
 * 5. 异步 Pipeline 存储（单次 LLM 调用提取事实 + 决策）
 * 6. 更新 Working Memory
 */
export const chat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, message, sessionId: clientSessionId } = req.body as ChatRequest;
    const user = req.user as UserContext;

    if (!workspaceId || !message) {
      res.status(400).json({
        error: 'Bad Request',
        message: '缺少必要参数: workspaceId 或 message',
      });
      return;
    }

    if (!message.trim()) {
      res.status(400).json({
        error: 'Bad Request',
        message: '消息不能为空',
      });
      return;
    }

    // 确定会话 ID（客户端提供或使用默认规则）
    const sessionId = clientSessionId ||
      WorkingMemoryService.buildDefaultSessionId(user.userId, workspaceId);

    // 1. 获取会话历史（Working Memory）
    workingMemoryService.getOrCreateSession(sessionId, user.userId, workspaceId);
    const sessionHistory = workingMemoryService.getSessionHistory(sessionId, user.userId);

    // 2. 检索相关长期记忆（混合检索）
    const memories = await memoryService.retrieveRelevantMemories(
      user.userId,
      workspaceId,
      message,
      5
    );

    // 3. 调用 LLM（长期记忆 + 会话历史 + 当前消息）
    const reply = await llmService.chat(user.userId, message, memories, sessionHistory);

    // 4. 更新 Working Memory（同步，确保下轮对话能看到本轮历史）
    workingMemoryService.appendMessages(sessionId, user.userId, message, reply);

    // 5. 异步 Pipeline：存储记忆（不阻塞响应）
    let memoriesStoredCount = 0;
    (async () => {
      memoriesStoredCount = await memoryService.processAndStoreMemory(
        user.userId,
        workspaceId,
        message,
        reply
      );
    })();

    // 6. 返回结果
    const response: ChatResponse = {
      response: reply,
      memoriesUsed: memories.length,
      memoriesStored: memoriesStoredCount,
      sessionId,
    };

    res.status(200).json(response);
  } catch (error) {
    if (error instanceof LLMError) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'LLM 服务异常',
        details: (error as Error).message,
      });
      return;
    }

    next(error);
  }
};
