// routes/answers.ts
import { Router } from 'express';
import { getAnswersForQuestionController } from '../controllers/answersController';

const router = Router();

/**
 * GET /answers/:context
 * Example final path: GET /api/answers/req_123abc
 */
router.get('/:context', getAnswersForQuestionController);

export default router;
