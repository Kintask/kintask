// controllers/askController.ts
import { Request, Response, NextFunction } from 'express';
import { logQuestion } from '../services/recallService'; // Function to store question + trigger FVM
import { isValidCid } from '../utils'; // Utility for CID validation

// --- Retry Configuration ---
// Increase retries and delay significantly for ~4 minutes total wait
const LOG_QUESTION_MAX_RETRIES = 10; // Example: 1 initial + 9 retries = 10 attempts
const LOG_QUESTION_RETRY_DELAY_MS = 25000; // Example: 25 seconds between retries
// Total potential wait time = (MAX_RETRIES - 1) * DELAY_MS
// (10 - 1) * 25000ms = 9 * 25000ms = 225000ms = 225 seconds = 3.75 minutes
// Adjust these values as needed to fine-tune the total duration.
// --- End Retry Configuration ---

export async function handleAskRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { question, knowledgeBaseCid, user } = req.body;
  const uniqueRequestContext = `req_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;

  // --- Input Validation ---
  if (!question || typeof question !== 'string' || question.trim() === '') { res.status(400).json({ error: 'Invalid request body: Missing or invalid "question".' }); return; }
  if (!knowledgeBaseCid || typeof knowledgeBaseCid !== 'string' || !isValidCid(knowledgeBaseCid)) { res.status(400).json({ error: 'Invalid request body: Missing or invalid "knowledgeBaseCid".' }); return; }
  if (question.length > 1500) { res.status(400).json({ error: 'Question exceeds maximum length (1500 characters).' }); return; }
  // --- End Validation ---

  console.log(`[Ask Controller] Received request | Context: ${uniqueRequestContext.substring(0, 15)}... | CID: ${knowledgeBaseCid.substring(0, 10)}...`);

  let recallKey: string | undefined;
  let lastError: any = null;

  // --- Retry Loop for logQuestion (Longer Wait) ---
  for (let attempt = 1; attempt <= LOG_QUESTION_MAX_RETRIES; attempt++) {
    try {
      console.log(`[Ask Controller] Attempt ${attempt}/${LOG_QUESTION_MAX_RETRIES} to log question for context ${uniqueRequestContext}...`);
      recallKey = await logQuestion(question, knowledgeBaseCid, uniqueRequestContext , user); // Pass user if needed

      if (recallKey) {
        console.log(`[Ask Controller] Question logged successfully on attempt ${attempt} | Key: ${recallKey}`);
        lastError = null;
        break; // Exit loop on success
      } else {
        console.warn(`[Ask Controller] logQuestion attempt ${attempt} returned undefined for ${uniqueRequestContext}. Retrying...`);
        lastError = new Error("logQuestion returned undefined (potential issue).");
      }

    } catch (error: any) {
      lastError = error;
      const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.warn(`[Ask Controller] Attempt ${attempt} failed for logQuestion (${uniqueRequestContext}): ${conciseError}`);
      // Optional: Add logic here to break early for non-retryable errors
      // e.g., if (error.message.includes("Insufficient funds")) { break; }
    }

    // Wait before next attempt if not successful and more retries left
    if (!recallKey && attempt < LOG_QUESTION_MAX_RETRIES) {
      console.log(`[Ask Controller] Waiting ${LOG_QUESTION_RETRY_DELAY_MS / 1000}s before next logQuestion attempt...`);
      await new Promise(resolve => setTimeout(resolve, LOG_QUESTION_RETRY_DELAY_MS));
    }
  } // --- End Retry Loop ---


  // --- Handle Final Outcome ---
  if (recallKey) {
    console.log(`[Ask Controller] Final success logging question for ${uniqueRequestContext}. Responding 202.`);
    res.status(202).json({
      message: "Question submitted successfully. Processing initiated.",
      requestContext: uniqueRequestContext,
      recallKey: recallKey
    });
  } else {
    const conciseError = lastError instanceof Error ? lastError.message.split('\n')[0] : String(lastError || "Unknown error after retries.");
    console.error(`[Ask Controller Error] Failed to log question for context ${uniqueRequestContext} after ${LOG_QUESTION_MAX_RETRIES} attempts. Last Error: ${conciseError}`);
    const userErrorMessage = process.env.NODE_ENV === 'production' ? 'Failed to submit question due to a persistent internal error.' : `Failed to submit question after multiple attempts: ${conciseError}`;
    if (!res.headersSent) {
      res.status(500).json({ error: 'Question Submission Failed', details: userErrorMessage });
    } else { console.error(`[Ask Controller Error] Headers already sent for ${uniqueRequestContext}, cannot send final error.`); }
  }
}
// ==== ./controllers/askController.ts ====