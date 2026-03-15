import { Request, Response, NextFunction } from 'express';
import { quotaService } from '../services/quota.service';
import type { UserContext } from '../types';

/**
 * Quota Controller
 *
 * GET  /api/quota                - 列出所有 workspace 配额
 * GET  /api/quota/:workspaceId   - 获取指定 workspace 配额
 * PUT  /api/quota/:workspaceId   - 更新 workspace 配额
 */

export const listQuotas = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const quotas = quotaService.listWorkspaceQuotas(user.userId);
    res.status(200).json({ quotas });
  } catch (error) {
    next(error);
  }
};

export const getQuota = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { workspaceId } = req.params;

    const quota = quotaService.getOrCreateQuota(user.userId, workspaceId);
    res.status(200).json(quota);
  } catch (error) {
    next(error);
  }
};

export const updateQuota = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { workspaceId } = req.params;
    const { maxMemories, requestsPerMinute, llmModel } = req.body;

    const updated = quotaService.updateQuota(user.userId, workspaceId, {
      maxMemories,
      requestsPerMinute,
      llmModel,
    });

    res.status(200).json({ message: '配额更新成功', quota: updated });
  } catch (error) {
    next(error);
  }
};
