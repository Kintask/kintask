// controllers/evaluationController.ts
import { Request, Response, NextFunction } from 'express';
import { isQuestionEvaluated } from '../services/recallService';
import { getEvaluationData } from '../services/recallService';


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

export async function getEvaluationDataController(req: Request, res: Response, next: NextFunction) {
    try {
      const { context } = req.params; // e.g. /api/evaluation-data/req_1234
      if (!context) {
        return res.status(400).json({ error: 'Missing "context" parameter.' });
      }
  
      // Call the new recallService function
      const data = await getEvaluationData(context);
      if (!data) {
        // Not found
        return res.status(404).json({ error: 'Not Found', message: 'No evaluation.json for this context.' });
      }
  
      // If found, return it
      res.json(data);  // e.g. { status: 'PendingPayout', results: [...], ... }
    } catch (error: any) {
      console.error('[getEvaluationDataController]', error);
      next(error); // Let global error handler handle it
    }
  }