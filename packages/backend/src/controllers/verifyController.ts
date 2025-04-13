// kintask/packages/backend/src/controllers/verifyController.ts

import { Request, Response, NextFunction } from 'express';
// Ensure correct import paths relative to this file
import { generateClaim } from '../services/generatorService'; // Assumes this specific function IS exported
import { performVerification } from '../services/verifierService'; // Assumes this specific function IS exported
// Removed unused logErrorEvent import for now
// import { logErrorEvent } from '../services/recallService';
import {
    VerificationResultInternal,
    ApiVerifyResponse, // Used for success/error response structure
    RecallLogEntryData // Type for reasoningSteps in VerificationResultInternal
    // Removed ApiErrorResponse import
} from '../types';
import { getL2ExplorerUrl, isValidCid } from '../utils'; // Assuming these utils exist and work

/**
 * Handles the original synchronous /verify request.
 * Performs claim generation and verification within a single request.
 * Returns the full result or an error immediately.
 */
// --- FIX: Correct Return Type ---
export async function handleVerifyRequest(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const { question, knowledgeBaseCid } = req.body;
  const uniqueRequestContext = `verify_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`; // Different prefix

  // Add logging for entry
  console.log(`[Verify Controller][${uniqueRequestContext}] Handling SYNC request - Q: "${question?.substring(0,50)}...", CID: ${knowledgeBaseCid?.substring(0,10)}...`);

  // --- Validation ---
  if (!question || typeof question !== 'string' || question.trim() === '') {
     console.warn(`[Verify Controller][${uniqueRequestContext}] Invalid question received.`);
     // --- FIX: Add return ---
     return res.status(400).json({ error: 'Invalid request body: Missing or invalid "question".', requestContext: uniqueRequestContext });
  } 
  if (!knowledgeBaseCid || typeof knowledgeBaseCid !== 'string' || !isValidCid(knowledgeBaseCid)) {
     console.warn(`[Verify Controller][${uniqueRequestContext}] Invalid knowledgeBaseCid received.`);
     // --- FIX: Add return ---
     return res.status(400).json({ error: 'Invalid request body: Missing or invalid "knowledgeBaseCid".', requestContext: uniqueRequestContext });
  }
  const trimmedQuestion = question.trim(); // Use trimmed versions
  const trimmedKnowledgeBaseCid = knowledgeBaseCid.trim();
  if (trimmedQuestion.length > 1500) {
     console.warn(`[Verify Controller][${uniqueRequestContext}] Question too long.`);
     // --- FIX: Add return ---
     return res.status(400).json({ error: 'Question exceeds maximum length (1500 characters).', requestContext: uniqueRequestContext });
  }
  // --- End Validation ---

  let verificationResult: VerificationResultInternal | null = null;
  let generatedClaim: string | undefined = undefined; // Initialize as undefined

  try {
    // Step 1: Generate Claim
    console.log(`[Verify Controller][${uniqueRequestContext}] Generating claim...`);
    generatedClaim = await generateClaim(trimmedQuestion, trimmedKnowledgeBaseCid, uniqueRequestContext); // Pass trimmed values

    // Validate claim generation result
    if (typeof generatedClaim !== 'string') {
        throw new Error('Generator service returned invalid type for claim (expected string).');
    }
    if (generatedClaim.startsWith('Error:')) {
        // Throw the specific error message from the generator
        throw new Error(`Claim Generation Failed: ${generatedClaim}`);
    }
    console.log(`[Verify Controller][${uniqueRequestContext}] Generated Claim: "${generatedClaim.substring(0,100)}..."`);


    // Step 2: Perform Verification
    console.log(`[Verify Controller][${uniqueRequestContext}] Performing verification...`);
    // Assuming performVerification expects 4 arguments for this synchronous flow
    verificationResult = await performVerification(trimmedQuestion, generatedClaim, trimmedKnowledgeBaseCid, uniqueRequestContext);

    // Validate verification result
    if (!verificationResult) {
        throw new Error("Verification service returned null result.");
    }
    console.log(`[Verify Controller][${uniqueRequestContext}] Verification Result Status: ${verificationResult.finalVerdict}`);
    if (verificationResult.finalVerdict.startsWith('Error:')) {
        // Log warning but don't throw, return the error status in the response
        console.warn(`[Verify Controller][${uniqueRequestContext}] Verification process ended with status: ${verificationResult.finalVerdict}`);
    }


    // Step 3: Prepare SUCCESS response payload carefully matching ApiVerifyResponse
    // Initialize with required fields or defaults
    const responsePayload: ApiVerifyResponse = {
      answer: generatedClaim, // Sync endpoint returns CLAIM as answer
      status: verificationResult.finalVerdict,
      confidence: verificationResult.confidenceScore,
      usedFragmentCids: verificationResult.usedFragmentCids,
      timelockRequestId: verificationResult.timelockRequestId,
      timelockTxExplorerUrl: verificationResult.timelockCommitTxHash ? getL2ExplorerUrl(verificationResult.timelockCommitTxHash) : undefined,
      recallTrace: verificationResult.reasoningSteps, // Include reasoning steps if available and desired
      requestContext: uniqueRequestContext,
      // Ensure optional error fields are omitted on success
      error: undefined,
      details: undefined,
    };

    // Clean payload (remove undefined keys) - This is good practice
    const finalPayload = Object.entries(responsePayload).reduce((acc, [key, value]) => {
        if (value !== undefined) {
            (acc as any)[key as keyof ApiVerifyResponse] = value;
        }
        return acc;
    }, {} as Partial<ApiVerifyResponse>);


    console.log(`[Verify Controller][${uniqueRequestContext}] Sending Sync Response | Status: ${finalPayload.status}`);
    // --- FIX: Add return ---
    return res.status(200).json(finalPayload);

  } catch (error: any) {
    const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`[Verify Controller Error][${uniqueRequestContext}]: Sync process failed! Error: ${conciseError}`);

    // Log error using recallService if available and configured
    // try {
    //     await logErrorEvent({ controllerError: conciseError, stage: 'VerifyControllerCatch' }, uniqueRequestContext);
    // } catch (logErr: any) {
    //      console.error(`[Verify Controller][${uniqueRequestContext}] FAILED TO LOG CONTROLLER ERROR TO RECALL:`, logErr.message);
    // }

    // Determine best "answer" and "status" for the error response
    const finalAnswerInError = (typeof generatedClaim === 'string' && !generatedClaim.startsWith('Error:')) ? generatedClaim : "Claim Generation/Processing Failed";
    const finalStatusInError = verificationResult?.finalVerdict?.startsWith('Error:') ? verificationResult.finalVerdict : 'Error: Verification Failed';

    // Prepare Error response payload carefully matching ApiVerifyResponse
    const errorResponsePayload: ApiVerifyResponse = {
        answer: finalAnswerInError,
        status: finalStatusInError,
        error: 'Verification processing error.', // General error type
        details: conciseError, // Specific error message
        confidence: verificationResult?.confidenceScore, // Include if available
        timelockRequestId: verificationResult?.timelockRequestId, // Include if available
        requestContext: uniqueRequestContext,
        recallTrace: verificationResult?.reasoningSteps, // Include steps if available
        usedFragmentCids: verificationResult?.usedFragmentCids, // Include if available
        timelockTxExplorerUrl: verificationResult?.timelockCommitTxHash ? getL2ExplorerUrl(verificationResult.timelockCommitTxHash) : undefined,
    };

     // Clean payload (remove undefined keys)
     const finalErrorPayload = Object.entries(errorResponsePayload).reduce((acc, [key, value]) => {
         if (value !== undefined) { (acc as any)[key as keyof ApiVerifyResponse] = value; }
         return acc;
     }, {} as Partial<ApiVerifyResponse>);


    if (!res.headersSent) {
        // --- FIX: Add return ---
        return res.status(500).json(finalErrorPayload);
    } else {
        console.error(`[Verify Controller Error][${uniqueRequestContext}] Headers already sent, cannot send error response.`);
        // Cannot return res here, but error is logged. Maybe call next(error)?
        // next(error); // Pass to global handler if headers sent (though ideally shouldn't happen)
    }
  }
}