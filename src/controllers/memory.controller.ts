import { Request, Response, NextFunction } from 'express';
import { milvusService } from '../services/milvus.service';
import { embeddingService } from '../services/embedding.service';
import { MilvusError } from '../utils/errors';
import type { UserContext } from '../types';

/**
 * Memory Controller
 *
 * 记忆管理接口：
 * - GET /api/memories - 获取当前用户、指定 workspace 下的所有记忆
 * - PUT /api/memories/:id - 修改记忆（必须校验 owner）
 * - DELETE /api/memories/:id - 删除记忆（必须校验 owner）
 */

/**
 * 获取记忆列表
 *
 * 【隔离保证】
 * - req.user.userId 由 authMiddleware 提供
 * - 查询时强制过滤 userId 和 workspaceId
 */
export const getMemories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = req.query;
    const user = req.user as UserContext;

    if (!workspaceId || typeof workspaceId !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: '缺少必要参数: workspaceId',
      });
      return;
    }

    // 【隔离保证】强制传入 user.userId
    const memories = await milvusService.getMemoriesByWorkspace(user.userId, workspaceId);

    res.status(200).json({
      count: memories.length,
      memories,
    });
  } catch (error) {
    if (error instanceof MilvusError) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Milvus 服务异常',
        details: error.message,
      });
      return;
    }

    next(error);
  }
};

/**
 * 更新记忆
 *
 * 【隔离保证】
 * 1. 先在 MilvusService 中校验记忆的 owner
 * 2. 只有 owner 才能更新
 * 3. MilvusService.updateMemory 强制传入 user.userId
 */
export const updateMemory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const user = req.user as UserContext;

    if (!content || typeof content !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: '缺少必要参数: content',
      });
      return;
    }

    // 生成新的向量
    const newVector = await embeddingService.generateEmbedding(content);

    // 【隔离保证】强制传入 user.userId，MilvusService 会校验 owner
    const success = await milvusService.updateMemory(
      user.userId,
      id,
      content,
      newVector
    );

    if (!success) {
      res.status(404).json({
        error: 'Not Found',
        message: '记忆不存在或不属于当前用户',
      });
      return;
    }

    res.status(200).json({
      message: '记忆更新成功',
      id,
      content,
    });
  } catch (error) {
    if (error instanceof MilvusError) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Milvus 服务异常',
        details: error.message,
      });
      return;
    }

    next(error);
  }
};

/**
 * 删除记忆
 *
 * 【隔离保证】
 * 1. MilvusService.deleteMemory 会先校验记忆的 owner
 * 2. 只有 owner 才能删除
 */
export const deleteMemory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = req.user as UserContext;

    // 【隔离保证】强制传入 user.userId，MilvusService 会校验 owner
    const success = await milvusService.deleteMemory(user.userId, id);

    if (!success) {
      res.status(404).json({
        error: 'Not Found',
        message: '记忆不存在或不属于当前用户',
      });
      return;
    }

    res.status(200).json({
      message: '记忆删除成功',
      id,
    });
  } catch (error) {
    if (error instanceof MilvusError) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Milvus 服务异常',
        details: error.message,
      });
      return;
    }

    next(error);
  }
};
