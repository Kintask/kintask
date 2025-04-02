import { Request, Response, NextFunction } from 'express';
import { generateAnswer } from '../services/generatorService';
import { performVerification } from '../services/verifierService';
import { logRecallEvent, getSimulatedTrace } from '../services/recallService';
import { VerificationResultInternal, ApiVerifyResponse } from '../types';
import { getL2ExplorerUrl } from '../utils';
import config from '../config'; // Already validated in config.ts

export async function handleVerifyRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { question } = req.body;
  const requestTimestamp = new Date().toISOString();
  // More robust unique context ID
  const uniqueRequestContext = `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;

  // Input Validation
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    res.status(400).json({ error: 'Invalid request body. Non-empty "question" string is required.' });
    return;
  }
  // Optional: Limit question length
  const MAX_QUESTION_LENGTH = 1000;
  if (question.length > MAX_QUESTION_LENGTH) {
       res.status(400).json({ error: `Question exceeds maximum length (${MAX_QUESTION_LENGTH} characters).` });
       return;
  }

  let verificationResult: VerificationResultInternal | null = null;
  let generatedAnswer = "Processing..."; // Initial state
  let responseStatus = 500; // Default to internal error
  let responsePayload: Partial<ApiVerifyResponse> = {
      answer: "Failed to process request.", // Default error answer
      status: "Error: Verification Failed",
  };

  console.log(`[Controller] Handling request ${uniqueRequestContext} for question: "${question.substring(0, 50)}..."`);
  try {
    // Log Start
    await logRecallEvent('VERIFICATION_START', { question }, uniqueRequestContext);

    // 1. Generate Answer
    generatedAnswer = await generateAnswer(question);
    if (generatedAnswer.startsWith('Error:')) {
         await logRecallEvent('VERIFICATION_ERROR', { step: 'Generator', error: generatedAnswer }, uniqueRequestContext);
         // Use the error message as the answer, but set error status
         responsePayload = {
             answer: generatedAnswer,
             status: 'Error: Verification Failed',
             error: 'Failed during answer generation.',
             details: generatedAnswer,
         };
         responseStatus = 500; // Keep as internal error
         // No throw here, proceed to send response in finally block
    } else {
        // 2. Perform Verification (Core logic) - only if generation succeeded
        verificationResult = await performVerification(question, generatedAnswer, uniqueRequestContext);

        // Handle case where verification service indicates failure (performVerification should always return a result now)
        if (verificationResult.finalVerdict.startsWith('Error:')) {
            const errorMsg = verificationResult.finalVerdict;
            // Error should have been logged within performVerification or its sub-services
            // await logRecallEvent('VERIFICATION_ERROR', { step: 'Verifier', error: errorMsg }, uniqueRequestContext); // Potentially redundant
            responsePayload = {
                answer: generatedAnswer, // Still return the generated answer
                status: errorMsg,
                error: 'Verification process failed.',
                details: errorMsg, // Use the status as details
                usedFragmentCids: verificationResult.usedFragmentCids, // Include partial results
                timelockRequestId: verificationResult.timelockRequestId,
                timelockTxExplorerUrl: verificationResult.timelockCommitTxHash ? getL2ExplorerUrl(verificationResult.timelockCommitTxHash) : undefined,
                ciphertextHash: verificationResult.ciphertextHash
            };
            responseStatus = 500; // Keep as internal error
            // No throw here, proceed to send response in finally block
        } else {
            // SUCCESS PATH
            await logRecallEvent(
                'FINAL_VERDICT_CALCULATED', // Log verdict as calculated (pre-reveal)
                {
                    calculatedVerdict: verificationResult.finalVerdict,
                    confidence: verificationResult.confidenceScore,
                    usedCids: verificationResult.usedFragmentCids,
                    timelockRequestId: verificationResult.timelockRequestId,
                },
                uniqueRequestContext
            );
            await logRecallEvent('VERIFICATION_COMPLETE', { status: verificationResult.finalVerdict }, uniqueRequestContext);

            // Prepare SUCCESS API Response Payload
            responsePayload = {
                answer: generatedAnswer,
                status: verificationResult.finalVerdict,
                confidence: verificationResult.confidenceScore,
                usedFragmentCids: verificationResult.usedFragmentCids,
                timelockRequestId: verificationResult.timelockRequestId,
                timelockTxExplorerUrl: verificationResult.timelockCommitTxHash
                    ? getL2ExplorerUrl(verificationResult.timelockCommitTxHash)
                    : undefined,
                ciphertextHash: verificationResult.ciphertextHash
                // recallTrace will be added in the finally block
                // recallExplorerUrl: // TODO: Add if Recall provides one
            };
            responseStatus = 200; // Set success status
            console.log(`[Controller] Verification successful for request ${uniqueRequestContext}. Status: ${verificationResult.finalVerdict}`);
        }
    }
  } catch (error: any) {
    // Catch unexpected errors during the flow (e.g., network issues before logging)
    console.error(`[Controller Critical Error Request: ${uniqueRequestContext}]:`, error.message, error.stack);
    // Ensure error is logged to Recall if possible
    await logRecallEvent('VERIFICATION_ERROR', { controllerError: error.message, stack: error.stack?.substring(0, 200) }, uniqueRequestContext)
        .catch(logErr => console.error("Failed to log critical controller error to Recall:", logErr)); // Avoid crashing if logging fails

    // Prepare ERROR API Response Payload for unexpected errors
    responsePayload = {
        answer: generatedAnswer === "Processing..." ? "Failed due to an unexpected server error." : generatedAnswer,
        status: verificationResult?.finalVerdict || 'Error: Verification Failed', // Use last known status if available
        error: 'An unexpected server error occurred.',
        details: error.message,
        // recallTrace will be added in finally block
    };
    responseStatus = 500;
  } finally {
      // Always retrieve and add the trace (even on error)
      responsePayload.recallTrace = getSimulatedTrace(uniqueRequestContext);
      // Send the response
      console.log(`[Controller] Sending final response for ${uniqueRequestContext} with status ${responseStatus}`);
      res.status(responseStatus).json(responsePayload);
  }
}
