import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import authRoutes from './auth.routes';
import chatRoutes from './chat.routes';
import memoryRoutes from './memory.routes';
import personaRoutes from './persona.routes';

const router = Router();

// Auth 路由 - 无需鉴权
router.use('/auth', authRoutes);

/**
 * 所有 /api/* 路由都需要经过 JWT 鉴权
 *
 * 【隔离策略第一道防线】
 * authMiddleware 会从 JWT 中提取 user_id 并挂载到 req.user
 * 后续所有 controller 都能从 req.user.userId 获取当前用户 ID
 */
router.use(authMiddleware);

// 需要鉴权的子路由
router.use('/chat', chatRoutes);
router.use('/memories', memoryRoutes);
router.use('/personas', personaRoutes);

export default router;
