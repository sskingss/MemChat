import { Router } from 'express';
import { chat, chatStream } from '../controllers/chat.controller';

const router = Router();

/**
 * POST /api/chat
 * 核心对话接口（阻塞式）
 */
router.post('/', chat);

/**
 * POST /api/chat/stream
 * 流式对话接口（SSE）
 */
router.post('/stream', chatStream);

export default router;
