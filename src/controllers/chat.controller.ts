import { Request, Response, NextFunction } from 'express';
import { memoryService } from '../services/memory.service';
import { llmService } from '../services/llm.service';
import { workingMemoryService, WorkingMemoryService } from '../services/working-memory.service';
import { emotionService } from '../services/emotion.service';
import { personaEvolutionService } from '../services/persona-evolution.service';
import { LLMError } from '../utils/errors';
import type { ChatRequest, ChatResponse, UserContext } from '../types';

/**
 * Chat Controller
 *
 * POST /api/chat - 阻塞式响应
 * POST /api/chat/stream - SSE 流式响应
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

    const sessionId = clientSessionId ||
      WorkingMemoryService.buildDefaultSessionId(user.userId, workspaceId);

    await workingMemoryService.getOrCreateSession(sessionId, user.userId, workspaceId);
    const sessionHistory = await workingMemoryService.getSessionHistory(sessionId, user.userId);

    const memories = await memoryService.retrieveRelevantMemories(
      user.userId,
      workspaceId,
      message,
      5
    );

    const reply = await llmService.chat(user.userId, message, memories, sessionHistory);

    await workingMemoryService.appendMessages(sessionId, user.userId, message, reply);

    // Async: store memory, track emotion, evolve persona
    (async () => {
      await memoryService.processAndStoreMemory(user.userId, workspaceId, message, reply);
      emotionService.trackEmotion(user.userId, message, reply).catch(() => {});
      personaEvolutionService.onChatCompleted(user.userId).catch(() => {});
    })();

    const response: ChatResponse = {
      response: reply,
      memoriesUsed: memories.length,
      memoriesStored: 0,
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

/**
 * SSE 流式对话接口
 *
 * POST /api/chat/stream
 * 返回 Server-Sent Events 流
 */
export const chatStream = async (req: Request, res: Response, next: NextFunction) => {
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

    const sessionId = clientSessionId ||
      WorkingMemoryService.buildDefaultSessionId(user.userId, workspaceId);

    await workingMemoryService.getOrCreateSession(sessionId, user.userId, workspaceId);
    const sessionHistory = await workingMemoryService.getSessionHistory(sessionId, user.userId);

    const memories = await memoryService.retrieveRelevantMemories(
      user.userId,
      workspaceId,
      message,
      5
    );

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send metadata event
    res.write(`data: ${JSON.stringify({ type: 'meta', memoriesUsed: memories.length, sessionId })}\n\n`);

    // Stream LLM response
    let fullReply = '';
    try {
      const stream = await llmService.chatStream(user.userId, message, memories, sessionHistory);

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullReply += content;
          res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
        }
      }
    } catch (streamError) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'LLM stream failed' })}\n\n`);
      res.end();
      return;
    }

    // Send done event
    res.write(`data: ${JSON.stringify({ type: 'done', fullResponse: fullReply })}\n\n`);
    res.end();

    // Async post-processing
    (async () => {
      await workingMemoryService.appendMessages(sessionId, user.userId, message, fullReply);
      await memoryService.processAndStoreMemory(user.userId, workspaceId, message, fullReply);
      emotionService.trackEmotion(user.userId, message, fullReply).catch(() => {});
      personaEvolutionService.onChatCompleted(user.userId).catch(() => {});
    })();
  } catch (error) {
    if (!res.headersSent) {
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
  }
};
