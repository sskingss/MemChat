import { Request, Response, NextFunction } from 'express';
import { memoryGraphService } from '../services/memory-graph.service';
import type { UserContext } from '../types';

/**
 * Graph Controller
 *
 * GET  /api/graph          - 获取用户知识图谱
 * GET  /api/graph/search   - 搜索相关实体
 * DELETE /api/graph/:entityId - 删除实体
 */

export const getGraph = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const limit = parseInt(req.query.limit as string) || 200;

    const graph = memoryGraphService.getGraph(user.userId, limit);

    res.status(200).json({
      entitiesCount: graph.entities.length,
      relationsCount: graph.relations.length,
      ...graph,
    });
  } catch (error) {
    next(error);
  }
};

export const searchRelatedEntities = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { entity, depth } = req.query;

    if (!entity || typeof entity !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: '缺少 entity 参数' });
      return;
    }

    const related = memoryGraphService.findRelatedEntities(
      user.userId,
      entity,
      parseInt(depth as string) || 1
    );

    res.status(200).json({ query: entity, relatedEntities: related, count: related.length });
  } catch (error) {
    next(error);
  }
};

export const deleteEntity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as UserContext;
    const { entityId } = req.params;

    const deleted = memoryGraphService.deleteEntity(user.userId, entityId);
    if (!deleted) {
      res.status(404).json({ error: 'Not Found', message: '实体不存在' });
      return;
    }

    res.status(200).json({ message: '实体及其关系已删除' });
  } catch (error) {
    next(error);
  }
};
