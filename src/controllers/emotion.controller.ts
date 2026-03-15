import { Request, Response, NextFunction } from 'express';
import { emotionService } from '../services/emotion.service';
import type { UserContext } from '../types';

/**
 * Emotion Controller
 *
 * GET /api/emotions/timeline - 获取情绪时间线
 * GET /api/emotions/current  - 获取当前情绪上下文
 */

export const getEmotionTimeline = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const days = parseInt(req.query.days as string) || 7;
    const limit = parseInt(req.query.limit as string) || 100;

    const timeline = emotionService.getTimeline(user.userId, days, limit);
    res.status(200).json(timeline);
  } catch (error) {
    next(error);
  }
};

export const getCurrentEmotion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const context = emotionService.getCurrentEmotionContext(user.userId);

    res.status(200).json({
      hasEmotionData: !!context,
      emotionContext: context,
    });
  } catch (error) {
    next(error);
  }
};
