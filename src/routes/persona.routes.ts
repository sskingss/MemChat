import { Router } from 'express';
import {
  startBootstrap,
  bootstrapChat,
  getBootstrapPreview,
  confirmBootstrap,
  getUserPersona,
  updateUserPersona,
  deleteUserPersona,
} from '../controllers/persona.controller';

const router = Router();

// ============ Bootstrap 引导接口 ============

/**
 * POST /api/personas/bootstrap/start
 * 开始引导会话
 */
router.post('/bootstrap/start', startBootstrap);

/**
 * POST /api/personas/bootstrap/chat
 * 引导对话
 */
router.post('/bootstrap/chat', bootstrapChat);

/**
 * GET /api/personas/bootstrap/preview
 * 获取人格预览
 */
router.get('/bootstrap/preview', getBootstrapPreview);

/**
 * POST /api/personas/bootstrap/confirm
 * 确认并保存人格
 */
router.post('/bootstrap/confirm', confirmBootstrap);

// ============ 用户人格管理接口 ============

/**
 * GET /api/personas/user
 * 获取用户当前人格
 */
router.get('/user', getUserPersona);

/**
 * PUT /api/personas/user
 * 更新用户人格
 */
router.put('/user', updateUserPersona);

/**
 * DELETE /api/personas/user
 * 删除用户人格
 */
router.delete('/user', deleteUserPersona);

export default router;
