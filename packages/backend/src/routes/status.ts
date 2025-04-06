// ./packages/backend/src/routes/status.ts
import { Router } from 'express';
import { handleStatusRequest } from '../controllers/statusController';

const router = Router();

// Route for checking the status of a submitted question by its requestContext ID
router.get('/status/:requestContext', handleStatusRequest);

export default router;
// ==== ./routes/status.ts ====