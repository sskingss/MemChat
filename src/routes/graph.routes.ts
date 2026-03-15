import { Router } from 'express';
import { getGraph, searchRelatedEntities, deleteEntity } from '../controllers/graph.controller';

const router = Router();

router.get('/', getGraph);
router.get('/search', searchRelatedEntities);
router.delete('/:entityId', deleteEntity);

export default router;
