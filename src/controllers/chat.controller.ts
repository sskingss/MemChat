import { Request, Response, NextFunction } from 'express';
import { memoryService } from '../services/memory.service';
import { llmService } from '../services/llm.service';
import { LLMError } from '../utils/errors';
import type { ChatRequest, ChatResponse, UserContext } from '../types';

/**
 * Chat Controller
 *
 * 核心对话接口：/api/chat
 *
 * 流程：
 * 1. 接收 workspace_id 和 message
 * 2. 携带 req.user.userId 和 workspaceId 去检索历史记忆（RAG）
 * 3. 组装 Prompt（包含历史记忆）
 * 4. 调用 LLM 生成回复
 * 5. 异步判断信息重要性，如果值得则存入 Milvus
 */
export const chat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. 提取参数
    const { workspaceId, message } = req.body as ChatRequest;
    const user = req.user as UserContext;

    // 参数校验
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

    // 2. 检索相关记忆（RAG）
    // 【隔离保证】强制传入 user.userId，确保只检索当前用户的记忆
    const memories = await memoryService.retrieveRelevantMemories(
      user.userId,
      workspaceId,
      message,
      5 // 取最相关的 5 条记忆
    );

    // 3. 调用 LLM 生成回复（传入 userId 获取人格）
    const reply = await llmService.chat(user.userId, message, memories);

    // 4. 异步处理记忆存储（不阻塞主流程）
    // 这样即使记忆存储失败，用户也能正常收到回复
    (async () => {
      await memoryService.processAndStoreMemory(
        user.userId,
        workspaceId,
        message,
        reply
      );
    })();

    // 5. 返回结果
    const response: ChatResponse = {
      response: reply,
      memoriesUsed: memories.length,
      memoriesStored: 1, // 触发了存储操作（实际是否存储由 LLM 判断）
    };

    res.status(200).json(response);
  } catch (error) {
    if (error instanceof LLMError) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'LLM 服务异常',
        details: error.message,
      });
      return;
    }

    next(error);
  }
};
