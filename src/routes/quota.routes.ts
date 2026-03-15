import { Router } from 'express';
import { listQuotas, getQuota, updateQuota } from '../controllers/quota.controller';

const router = Router();

router.get('/', listQuotas);
router.get('/:workspaceId', getQuota);
router.put('/:workspaceId', updateQuota);

export default router;
