// ./packages/backend/src/routes/ask.ts
import { Router } from 'express';
import { handleAskRequest } from '../controllers/askController';

const router = Router();

// Route for submitting questions asynchronously
router.post('/ask', handleAskRequest);

export default router;
// ==== ./routes/ask.ts ====    