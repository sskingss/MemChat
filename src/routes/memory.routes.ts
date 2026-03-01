import { Router } from 'express';
import { getMemories, updateMemory, deleteMemory } from '../controllers/memory.controller';

const router = Router();

/**
 * GET /api/memories
 *
 * 获取记忆列表
 * - 鉴权：需要 JWT token
 * - Query 参数：workspaceId
 * - 响应体：{ count: number, memories: MemoryQueryResult[] }
 */
router.get('/', getMemories);

/**
 * PUT /api/memories/:id
 *
 * 更新记忆
 * - 鉴权：需要 JWT token
 * - 路径参数：id (记忆 ID)
 * - 请求体：{ content: string }
 * - 响应体：{ message: string, id: string, content: string }
 */
router.put('/:id', updateMemory);

/**
 * DELETE /api/memories/:id
 *
 * 删除记忆
 * - 鉴权：需要 JWT token
 * - 路径参数：id (记忆 ID)
 * - 响应体：{ message: string, id: string }
 */
router.delete('/:id', deleteMemory);

export default router;
