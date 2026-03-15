import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware';
import authRoutes from './auth.routes';
import chatRoutes from './chat.routes';
import memoryRoutes from './memory.routes';
import personaRoutes from './persona.routes';
import graphRoutes from './graph.routes';
import emotionRoutes from './emotion.routes';
import multimodalRoutes from './multimodal.routes';
import quotaRoutes from './quota.routes';
import platformRoutes from './platform.routes';

const router = Router();

// Auth 路由 - 无需鉴权
router.use('/auth', authRoutes);

// 所有 /api/* 路由都需要经过 JWT 鉴权 + 频率限制
router.use(authMiddleware);
router.use(rateLimitMiddleware);

// 核心路由
router.use('/chat', chatRoutes);
router.use('/memories', memoryRoutes);
router.use('/personas', personaRoutes);

// 新增路由
router.use('/graph', graphRoutes);
router.use('/emotions', emotionRoutes);
router.use('/import', multimodalRoutes);
router.use('/quota', quotaRoutes);
router.use('/platform', platformRoutes);

export default router;
