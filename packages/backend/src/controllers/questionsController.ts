// controllers/questionsController.ts

import { Request, Response, NextFunction } from 'express';
import { getAllQuestionsForUser } from '../services/recallService';

export async function getUserQuestionsController(req: Request, res: Response, next: NextFunction) {
  try {
    const { user } = req.params; // If your route is /questions/user/:user
    if (!user) {
      res.status(400).json({ error: 'Missing user parameter' });
      return;
    }

    const questions = await getAllQuestionsForUser(user);
    res.json(questions); // Return as JSON array
  } catch (error: any) {
    console.error(`[getUserQuestionsController] Error:`, error.message);
    next(error);
  }
}
