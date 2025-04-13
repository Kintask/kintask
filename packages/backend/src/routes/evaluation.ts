// routes/evaluation.ts
import { Router } from 'express';
import { checkQuestionEvaluationController, getEvaluationDataController } from '../controllers/evaluationController';

const router = Router();

// Example route: GET /api/check-evaluation/:context
router.get('/check-evaluation/:context', checkQuestionEvaluationController);

router.get('/evaluation-data/:context', getEvaluationDataController);


export default router;
