import { Router } from 'express';
import { chat } from '../controllers/chat.controller';

const router = Router();

/**
 * POST /api/chat
 *
 * 核心对话接口
 * - 鉴权：需要 JWT token
 * - 请求体：{ workspaceId: string, message: string }
 * - 响应体：{ response: string, memoriesUsed: number, memoriesStored: number }
 */
router.post('/', chat);

export default router;
