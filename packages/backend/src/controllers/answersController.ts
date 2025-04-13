// controllers/answersController.ts
import { Request, Response, NextFunction } from 'express';
import { getAnswersForQuestion } from '../services/recallService';

export async function getAnswersForQuestionController(req: Request, res: Response, next: NextFunction) {
  try {
    const { context } = req.params;
    if (!context) {
      return res.status(400).json({
        error: 'Missing context parameter',
        message: 'Expected /answers/:context'
      });
    }

    const answers = await getAnswersForQuestion(context);
    // Return the array (could be empty if no answers found)
    return res.json(answers);
  } catch (error: any) {
    console.error('[getAnswersForQuestionController]', error.message);
    next(error);
  }
}
