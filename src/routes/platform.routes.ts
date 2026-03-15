import { Router } from 'express';
import { getMetrics, getDashboard } from '../controllers/platform.controller';

const router = Router();

router.get('/metrics', getMetrics);
router.get('/dashboard', getDashboard);

export default router;
