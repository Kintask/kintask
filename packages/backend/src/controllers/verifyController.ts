// src/controllers/verifyController.ts
import { Request, Response, NextFunction } from 'express';
// Ensure correct import paths relative to this file
import { generateClaim } from '../services/generatorService'; // Assuming src/services/generatorService.ts
import { performVerification } from '../services/verifierService'; // Assuming src/services/verifierService.ts
// import { logErrorEvent } from '../services/recallService'; // Assuming src/services/recallService.ts
import { VerificationResultInternal, ApiVerifyResponse, RecallLogEntryData } from '../types'; // Assuming src/types/index.ts
import { getL2ExplorerUrl, isValidCid } from '../utils'; // Assuming src/utils/index.ts

/**
 * Handles the original synchronous /verify request.
 * Performs claim generation and verification within a single request.
 * Kept for reference or direct use cases but differs from the async flow.
 */
export async function handleVerifyRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { question, knowledgeBaseCid } = req.body;
  const uniqueRequestContext = `verify_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`; // Different prefix

  console.warn(`[Verify Controller] WARN: Using synchronous /verify endpoint. Context: ${uniqueRequestContext.substring(0,15)}...`);

  // --- Validation ---
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

  let verificationResult: VerificationResultInternal | null = null;
  let generatedClaim: string | undefined = "Processing...";

  console.log(`[Verify Controller] Handling sync request ${uniqueRequestContext.substring(0, 15)}... | KB CID: ${knowledgeBaseCid.substring(0,10)}...`);
  try {
    // Step 1: Generate Claim (ensure generateClaim is exported and handles CID)
    // Note: This assumes generateClaim still exists and functions as originally intended
    // If it was removed or fully replaced by generateAnswerFromContent, this will fail.
    generatedClaim = await generateClaim(question, knowledgeBaseCid, uniqueRequestContext);
    if (typeof generatedClaim !== 'string') { throw new Error('Generator returned invalid type'); }
    if (generatedClaim.startsWith('Error:')) { throw new Error(`Claim Generation Failed: ${generatedClaim}`); }
    console.log(`[Verify Controller] Generated Claim: ${generatedClaim.substring(0,100)}...`);

    // Step 2: Perform Verification (ensure performVerification is exported and handles CID)
    verificationResult = await performVerification(question, generatedClaim, knowledgeBaseCid, uniqueRequestContext);
    if (!verificationResult) { throw new Error("Verification service returned null result"); }
    console.log(`[Verify Controller] Verification Result Status: ${verificationResult.finalVerdict}`);
    if (verificationResult.finalVerdict.startsWith('Error:')) {
        console.warn(`[Verify Controller] Verification ended with status: ${verificationResult.finalVerdict}`);
    }

    // Step 3: Prepare SUCCESS response
    // Ensure properties match the ApiVerifyResponse interface in types/index.ts
    const responsePayloadRaw: Partial<ApiVerifyResponse> = {
      answer: generatedClaim, // This endpoint returns the CLAIM as 'answer'
      status: verificationResult.finalVerdict,
      confidence: verificationResult.confidenceScore,
      usedFragmentCids: verificationResult.usedFragmentCids,
      timelockRequestId: verificationResult.timelockRequestId,
      timelockTxExplorerUrl: verificationResult.timelockCommitTxHash ? getL2ExplorerUrl(verificationResult.timelockCommitTxHash) : undefined,
      recallTrace: verificationResult.reasoningSteps, // Uses reasoningSteps from VerificationResultInternal
      requestContext: uniqueRequestContext,
    };

    // Remove undefined fields using type assertion in reduce
    const responsePayload = Object.entries(responsePayloadRaw).reduce((acc, [key, value]) => {
        if (value !== undefined) {
            // Assert key is a keyof ApiVerifyResponse before assigning
            (acc as any)[key as keyof ApiVerifyResponse] = value;
        }
        return acc;
    }, {} as Partial<ApiVerifyResponse>) as ApiVerifyResponse;

    console.log(`[Verify Controller] Sending Sync Response | Status: ${responsePayload.status}`);
    res.status(200).json(responsePayload);

  } catch (error: any) {
    const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`[Verify Controller Error] Context: ${uniqueRequestContext} | Error: ${conciseError}`);

    // Log error using unified service
    // logErrorEvent({ controllerError: conciseError, stage: 'VerifyControllerCatch' }, uniqueRequestContext).catch(/* ignore background log fail */);

    const finalAnswerInError = (typeof generatedClaim === 'string' && generatedClaim !== "Processing...") ? generatedClaim : "Claim Generation Failed";
    const finalStatusInError = verificationResult?.finalVerdict?.startsWith('Error:')
        ? verificationResult.finalVerdict
        : 'Error: Verification Failed';

    // Prepare Error response
    const simpleErrorResponseRaw: Partial<ApiVerifyResponse> = {
        answer: finalAnswerInError,
        status: finalStatusInError,
        error: 'Verification processing error.',
        details: conciseError,
        confidence: verificationResult?.confidenceScore,
        timelockRequestId: verificationResult?.timelockRequestId,
        requestContext: uniqueRequestContext,
        recallTrace: verificationResult?.reasoningSteps, // Use reasoningSteps
    };

    // Use type assertion in reduce for error response as well
    const simpleErrorResponse = Object.entries(simpleErrorResponseRaw).reduce((acc, [key, value]) => {
         if (value !== undefined) {
             (acc as any)[key as keyof ApiVerifyResponse] = value;
         }
         return acc;
     }, {} as Partial<ApiVerifyResponse>);

    if (!res.headersSent) {
        res.status(500).json(simpleErrorResponse);
    } else {
        console.error(`[Verify Controller Error] Headers already sent for context ${uniqueRequestContext}`);
    }
  }
}
// ==== ./src/controllers/verifyController.ts ====