// ./packages/backend/src/routes/verify.ts
import { Router } from 'express';
import { handleVerifyRequest } from '../controllers/verifyController';

const router = Router();

router.post('/verify', handleVerifyRequest);

export default router;