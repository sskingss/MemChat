import { Request, Response, NextFunction } from 'express';
import { personaEvolutionService } from '../services/persona-evolution.service';
import type { UserContext } from '../types';

/**
 * Evolution Controller
 *
 * GET  /api/personas/evolution         - 获取人格演变历史
 * POST /api/personas/evolution/reflect - 手动触发人格反思
 */

export const getEvolution = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;

    const versions = personaEvolutionService.getVersionHistory(user.userId);
    const log = personaEvolutionService.getEvolutionLog(user.userId);

    res.status(200).json({
      versionsCount: versions.length,
      versions,
      evolutionLog: log,
    });
  } catch (error) {
    next(error);
  }
};

export const triggerReflection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;

    const result = await personaEvolutionService.triggerReflection(user.userId);

    res.status(200).json({
      message: result.updated ? '人格已更新' : '无需更新',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};
