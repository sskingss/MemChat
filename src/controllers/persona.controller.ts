import { Request, Response, NextFunction } from 'express';
import { personaService } from '../services/persona.service';
import { personaBootstrapService } from '../services/persona-bootstrap.service';
import type { UserContext, UpdatePersonaRequest, BootstrapChatRequest } from '../types';

/**
 * Persona Controller
 *
 * 人格相关接口
 */

// ============ Bootstrap 引导接口 ============

/**
 * 开始引导会话
 * POST /api/personas/bootstrap/start
 */
export const startBootstrap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;

    // 检查用户是否已有人格
    const hasPersona = await personaService.hasPersona(user.userId);
    if (hasPersona) {
      res.status(400).json({
        error: 'Bad Request',
        message: '用户已有人格配置，如需重新创建请先删除现有人格',
      });
      return;
    }

    const session = await personaBootstrapService.startSession(user.userId);

    // 获取最后一条 AI 消息
    const lastMessage = session.conversationHistory[session.conversationHistory.length - 1];

    res.status(200).json({
      sessionId: session.id,
      phase: session.phase,
      message: lastMessage?.content || '',
      extractedFields: Object.keys(session.extractedData),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 引导对话
 * POST /api/personas/bootstrap/chat
 */
export const bootstrapChat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { message, sessionId } = req.body as BootstrapChatRequest;

    if (!message) {
      res.status(400).json({
        error: 'Bad Request',
        message: '缺少 message 参数',
      });
      return;
    }

    const response = await personaBootstrapService.chat(user.userId, message, sessionId);

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * 获取人格预览
 * GET /api/personas/bootstrap/preview
 */
export const getBootstrapPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { sessionId } = req.query;

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: '缺少 sessionId 参数',
      });
      return;
    }

    const preview = await personaBootstrapService.getPreview(sessionId, user.userId);

    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
};

/**
 * 确认并保存人格
 * POST /api/personas/bootstrap/confirm
 */
export const confirmBootstrap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({
        error: 'Bad Request',
        message: '缺少 sessionId 参数',
      });
      return;
    }

    const persona = await personaBootstrapService.confirmAndSave(sessionId, user.userId);

    res.status(200).json({
      message: '人格创建成功',
      persona,
    });
  } catch (error) {
    next(error);
  }
};

// ============ 用户人格管理接口 ============

/**
 * 获取用户当前人格
 * GET /api/personas/user
 */
export const getUserPersona = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    console.log(`[PersonaController] 检查用户人格, userId: ${user.userId}`);

    const persona = await personaService.getUserPersona(user.userId);
    console.log(`[PersonaController] 查询结果: hasPersona = ${persona !== null}`, persona ? `persona.id = ${persona.id}` : 'no persona');

    res.status(200).json({
      hasPersona: persona !== null,
      persona,
    });
  } catch (error) {
    console.error('[PersonaController] 获取用户人格失败:', error);
    next(error);
  }
};

/**
 * 更新用户人格
 * PUT /api/personas/user
 */
export const updateUserPersona = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const updates = req.body as UpdatePersonaRequest;

    const updatedPersona = await personaService.updatePersona(user.userId, updates);

    if (!updatedPersona) {
      res.status(404).json({
        error: 'Not Found',
        message: '用户没有人格配置',
      });
      return;
    }

    res.status(200).json({
      message: '人格更新成功',
      persona: updatedPersona,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 删除用户人格
 * DELETE /api/personas/user
 */
export const deleteUserPersona = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const deleted = await personaService.deletePersona(user.userId);

    if (!deleted) {
      res.status(404).json({
        error: 'Not Found',
        message: '用户没有人格配置',
      });
      return;
    }

    res.status(200).json({
      message: '人格删除成功',
    });
  } catch (error) {
    next(error);
  }
};
