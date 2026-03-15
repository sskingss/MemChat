import { Router } from 'express';
import { importBatch, importText, importMarkdown, importJSON } from '../controllers/multimodal.controller';

const router = Router();

router.post('/import', importBatch);
router.post('/import/text', importText);
router.post('/import/markdown', importMarkdown);
router.post('/import/json', importJSON);

export default router;
