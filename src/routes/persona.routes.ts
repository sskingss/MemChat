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
import { getEvolution, triggerReflection } from '../controllers/evolution.controller';

const router = Router();

// Bootstrap 引导接口
router.post('/bootstrap/start', startBootstrap);
router.post('/bootstrap/chat', bootstrapChat);
router.get('/bootstrap/preview', getBootstrapPreview);
router.post('/bootstrap/confirm', confirmBootstrap);

// 用户人格管理接口
router.get('/user', getUserPersona);
router.put('/user', updateUserPersona);
router.delete('/user', deleteUserPersona);

// 人格进化接口
router.get('/evolution', getEvolution);
router.post('/evolution/reflect', triggerReflection);

export default router;
