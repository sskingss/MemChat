import { Request, Response, NextFunction } from 'express';
import { platformService } from '../services/platform.service';
import type { UserContext } from '../types';

/**
 * Platform Controller
 *
 * GET /api/platform/metrics    - JSON 格式运行时指标
 * GET /api/platform/dashboard  - 用户 Dashboard
 * GET /metrics                 - Prometheus 格式指标（无需鉴权）
 */

export const getMetrics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metrics = platformService.getMetrics();
    res.status(200).json(metrics);
  } catch (error) {
    next(error);
  }
};

export const getDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const dashboard = await platformService.getUserDashboard(user.userId);
    res.status(200).json(dashboard);
  } catch (error) {
    next(error);
  }
};

export const getPrometheusMetrics = async (req: Request, res: Response) => {
  const metrics = platformService.getPrometheusMetrics();
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.status(200).send(metrics);
};
