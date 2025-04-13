// routes/evaluation.ts
import { Router } from 'express';
import { checkQuestionEvaluationController } from '../controllers/evaluationController';

const router = Router();

// Example route: GET /api/check-evaluation/:context
router.get('/check-evaluation/:context', checkQuestionEvaluationController);

export default router;
