import { Router } from 'express';
import { handleVerifyRequest } from '../controllers/verifyController';

const router = Router();

/**
 * @route POST /api/verify
 * @description Endpoint to receive a question, generate an answer, verify it,
 *              commit the verdict via timelock, log the process to Recall,
 *              and return the results.
 * @body { "question": "string" } - The user's question. Max length ~1500 chars recommended.
 * @returns {ApiVerifyResponse} 200 - Success response with answer, status, proofs.
 * @returns {object} 400 - Invalid request body (missing question, too long, etc.).
 * @returns {object} 500 - Internal server error during processing.
 */
router.post('/verify', handleVerifyRequest);

export default router;
