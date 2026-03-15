import { Request, Response, NextFunction } from 'express';
import { quotaService } from '../services/quota.service';
import { config } from '../config';
import type { UserContext } from '../types';

/**
 * 请求频率限制中间件
 *
 * 基于 workspace 级别的配额配置，限制每分钟请求数。
 * 仅在 quota.enabled 为 true 时生效。
 */
export const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!config.quota.enabled) {
    return next();
  }

  const user = req.user as UserContext | undefined;
  if (!user) {
    return next();
  }

  const workspaceId = (req.body?.workspaceId || req.query?.workspaceId || 'default') as string;
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

  const { allowed, remaining } = quotaService.checkRateLimit(user.userId, workspaceId, endpoint);

  res.setHeader('X-RateLimit-Remaining', remaining.toString());

  if (!allowed) {
    res.status(429).json({
      error: 'Too Many Requests',
      message: '请求频率超限，请稍后再试',
      retryAfterSeconds: 60,
    });
    return;
  }

  next();
};
