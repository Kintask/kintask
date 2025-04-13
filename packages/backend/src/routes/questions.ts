// routes/questions.ts
import { Router } from 'express';
import { getUserQuestionsController } from '../controllers/questionsController';

const router = Router();

// GET /questions/user/:user
router.get('/user/:user', getUserQuestionsController);

export default router;
