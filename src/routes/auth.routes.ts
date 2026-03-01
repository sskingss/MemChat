import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';

const router = Router();

/**
 * POST /auth/register
 *
 * 用户注册
 * - 请求体: { username: string }
 * - 响应体: { userId: string, username: string, token: string }
 */
router.post('/register', register);

/**
 * POST /auth/login
 *
 * 用户登录
 * - 请求体: { username: string }
 * - 响应体: { userId: string, username: string, token: string }
 */
router.post('/login', login);

export default router;
