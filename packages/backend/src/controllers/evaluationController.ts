// controllers/evaluationController.ts
import { Request, Response, NextFunction } from 'express';
import { isQuestionEvaluated } from '../services/recallService';

/**
 * Check if a specific question (by context) has been evaluated.
 */
export async function checkQuestionEvaluationController(req: Request, res: Response, next: NextFunction) {
  try {
    const { context } = req.params; // e.g. GET /check-evaluation/req_12345
    if (!context) {
      return res.status(400).json({ error: 'Missing "context" parameter.' });
    }

    const evaluated = await isQuestionEvaluated(context);
    if (evaluated) {
      return res.json({ evaluated: true, message: 'Question has been evaluated.' });
    } else {
      return res.json({ evaluated: false, message: 'Question is NOT evaluated yet.' });
    }
  } catch (error: any) {
    console.error("[checkQuestionEvaluationController]", error.message);
    next(error); // Pass to global error handler
  }
}
