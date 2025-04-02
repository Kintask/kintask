import { Router } from 'express';
import { handleVerifyRequest } from '../controllers/verifyController';

const router = Router();

/**
 * @route POST /api/verify
 * @description Endpoint to receive a question, generate an answer, verify it,
 *              commit the verdict via timelock, log the process to Recall,
 *              and return the results.
 * @body { "question": "string" } - The user's question.
 * @returns {ApiVerifyResponse} 200 - Success response with answer, status, proofs.
 * @returns {object} 400 - Invalid request body.
 * @returns {object} 500 - Internal server error during processing.
 */
router.post('/verify', handleVerifyRequest);

// Example: Add a route to get server status or config (for debugging)
// router.get('/status', (req, res) => {
//     res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

export default router;
