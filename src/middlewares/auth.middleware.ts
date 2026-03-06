import jwt, { SignOptions } from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { AuthError } from '../utils/errors';
import type { UserContext } from '../types';

// 扩展 Express Request 类型，添加 user 属性
declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

/**
 * JWT 鉴权中间件
 *
 * 【隔离策略第一道防线】
 * 拦截所有发往 /api/* 的请求，解析 token 并提取 user_id
 * 如果 token 无效或 user_id 不存在，直接拒绝请求
 *
 * 安全设计：
 * 1. 使用 jwt.verify 验证 token 完整性
 * 2. 提取的 user_id 会挂载到 req.user.userId
 * 3. 后续所有服务层调用必须传入 req.user.userId
 * 4. 即使恶意请求绕过中间件，MilvusService 也会进行二次校验
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. 从 Authorization header 获取 token
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('缺少 Authorization header 或格式错误');
    }

    const token = authHeader.substring(7); // 移除 'Bearer ' 前缀

    // 2. 验证 token 并解析 payload
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      iat: number;
      exp: number;
    };

    // 3. 校验 payload 中是否存在 userId
    if (!decoded.userId) {
      throw new AuthError('Token 中缺少 userId');
    }

    // 4. 将 user_id 挂载到 req.user，供后续中间件和 controller 使用
    req.user = {
      userId: decoded.userId,
    };

    next();
  } catch (error) {
    // token 过期或无效
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'Unauthorized',
        message: '无效的 JWT token',
      });
      return;
    }

    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'JWT token 已过期',
      });
      return;
    }

    if (error instanceof AuthError) {
      res.status(401).json({
        error: 'Unauthorized',
        message: error.message,
      });
      return;
    }

    // 其他未知错误
    res.status(500).json({
      error: 'Internal Server Error',
      message: '鉴权过程出错',
    });
  }
};

/**
 * 生成 JWT token
 *
 * 在真实项目中，这应该放在 login endpoint 的 controller 中
 */
export const generateToken = (userId: string): string => {
  return jwt.sign({ userId }, config.jwt.secret, { expiresIn: '7d' });
};
