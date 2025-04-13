// controllers/askController.ts
import { Request, Response, NextFunction } from 'express';
import { logQuestion } from '../services/recallService'; // Function to store question in Recall
import { isValidCid } from '../utils'; // Utility for CID validation

export async function handleAskRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { question, knowledgeBaseCid, user} = req.body;
  // Generate a unique ID for this request flow
  const uniqueRequestContext = `req_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;

  // --- Input Validation ---
  if (!question || typeof question !== 'string' || question.trim() === '') {
     res.status(400).json({ error: 'Invalid request body: Missing or invalid "question".' }); return;
  }
  if (!knowledgeBaseCid || typeof knowledgeBaseCid !== 'string' || !isValidCid(knowledgeBaseCid)) {
     res.status(400).json({ error: 'Invalid request body: Missing or invalid "knowledgeBaseCid".' }); return;
  }
  if (question.length > 1500) { // Example length limit
     res.status(400).json({ error: 'Question exceeds maximum length (1500 characters).' }); return;
  }
  // --- End Validation ---

  console.log(`[Ask Controller] Received request | Context: ${uniqueRequestContext.substring(0, 15)}... | CID: ${knowledgeBaseCid.substring(0,10)}...`);

  try {
    // --- Store the question and CID in Recall ---
    // This function handles interaction with the Recall service
    const recallKey = await logQuestion(question, knowledgeBaseCid, uniqueRequestContext, user);

    if (!recallKey) {
        // If logging fails, it's a server-side issue
        console.error(`[Ask Controller Error] Failed to log question to Recall service for context ${uniqueRequestContext}`);
        throw new Error("Failed to log question to persistence layer.");
    }

    console.log(`[Ask Controller] Question logged to Recall | Key: ${recallKey}`);

    // --- Respond Quickly to User ---
    // Use 202 Accepted status code to indicate the request is accepted for processing,
    // but the processing is not complete.
    res.status(202).json({
      message: "Question submitted successfully. Processing initiated.",
      requestContext: uniqueRequestContext, // ID for the user to check status later
      recallKey: recallKey // The specific key used in Recall for this question
    });

  } catch (error: any) {
    const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`[Ask Controller Error] Context: ${uniqueRequestContext} | Error: ${conciseError}`);

    // Avoid sending detailed internal errors in production
    const userErrorMessage = process.env.NODE_ENV === 'production'
        ? 'Failed to submit question due to an internal error.'
        : `Failed to submit question: ${conciseError}`;

    // Ensure headers aren't already sent before sending error response
    if (!res.headersSent) {
      res.status(500).json({
          error: 'Question Submission Failed',
          details: userErrorMessage
      });
    } else {
      console.error(`[Ask Controller Error] Headers already sent for context ${uniqueRequestContext}, cannot send error response.`);
    }
  }
}
// ==== ./controllers/askController.ts ====