import { Request, Response, NextFunction } from 'express';
import { multimodalService } from '../services/multimodal.service';
import type { UserContext } from '../types';

/**
 * Multimodal Controller
 *
 * POST /api/memories/import      - 批量导入记忆
 * POST /api/memories/import/text - 导入纯文本
 * POST /api/memories/import/markdown - 导入 Markdown
 * POST /api/memories/import/json - 导入 JSON
 */

export const importBatch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { workspaceId, items } = req.body;

    if (!workspaceId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: '缺少 workspaceId 或 items 数组' });
      return;
    }

    const result = await multimodalService.importBatch(user.userId, workspaceId, items);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const importText = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { workspaceId, text, source, category } = req.body;

    if (!workspaceId || !text) {
      res.status(400).json({ error: 'Bad Request', message: '缺少 workspaceId 或 text' });
      return;
    }

    const result = await multimodalService.importText(user.userId, workspaceId, text, source, category);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const importMarkdown = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { workspaceId, markdown, source } = req.body;

    if (!workspaceId || !markdown) {
      res.status(400).json({ error: 'Bad Request', message: '缺少 workspaceId 或 markdown' });
      return;
    }

    const result = await multimodalService.importMarkdown(user.userId, workspaceId, markdown, source);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const importJSON = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { workspaceId, json, source } = req.body;

    if (!workspaceId || !json) {
      res.status(400).json({ error: 'Bad Request', message: '缺少 workspaceId 或 json' });
      return;
    }

    const jsonString = typeof json === 'string' ? json : JSON.stringify(json);
    const result = await multimodalService.importJSON(user.userId, workspaceId, jsonString, source);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
