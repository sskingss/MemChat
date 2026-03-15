import { Router } from 'express';
import { getEmotionTimeline, getCurrentEmotion } from '../controllers/emotion.controller';

const router = Router();

router.get('/timeline', getEmotionTimeline);
router.get('/current', getCurrentEmotion);

export default router;
