import { Request, Response, NextFunction } from 'express';
import { generateAnswer } from '../services/generatorService';
import { performVerification } from '../services/verifierService';
import { logRecallEvent, getTraceFromRecall } from '../services/recallService';
import { VerificationResultInternal, ApiVerifyResponse } from '../types';
import { getL2ExplorerUrl } from '../utils';
import config from '../config'; // Import config if needed for L2 Chain ID for explorer

export async function handleVerifyRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { question } = req.body;
  const requestTimestamp = new Date().toISOString();
  // Create a unique context ID for this specific request to correlate Recall logs
  const uniqueRequestContext = `req_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;

  // --- Input Validation ---
  if (!question || typeof question !== 'string' || question.trim() === '') {
    res.status(400).json({ error: 'Invalid request body. Non-empty "question" string is required.' });
    return;
  }
  if (question.length > 1500) { // Limit question length
       res.status(400).json({ error: 'Question exceeds maximum length (1500 characters).' });
       return;
  }

  let verificationResult: VerificationResultInternal | null = null;
  let finalAnswer = "Processing..."; // Initial state

  console.log(`[Controller] Handling request ${uniqueRequestContext} for question: "${question.substring(0, 50)}..."`);
  try {
    // --- Log Start ---
    // Use await to ensure start is logged before proceeding, good for tracing flows
    await logRecallEvent('VERIFICATION_START', { question: question.substring(0, 200) + (question.length > 200 ? '...' : '') }, uniqueRequestContext);

    // --- 1. Generate Answer (Mocked) ---
    finalAnswer = await generateAnswer(question);
    // Check if mock returned an error string
    if (finalAnswer.startsWith('Error:')) {
         await logRecallEvent('VERIFICATION_ERROR', { step: 'GeneratorMock', error: finalAnswer }, uniqueRequestContext);
         throw new Error(`Mock Generator failed: ${finalAnswer}`);
    }
    await logRecallEvent('GENERATOR_MOCK_USED', { question: question.substring(0, 50) + '...', generatedAnswer: finalAnswer.substring(0, 50) + '...' }, uniqueRequestContext);


    // --- 2. Perform Verification ---
    verificationResult = await performVerification(question, finalAnswer, uniqueRequestContext);

    // Handle critical failure within the verification service itself
    if (!verificationResult) {
        await logRecallEvent('VERIFICATION_ERROR', { step: 'Verifier', error: "Verifier service returned null" }, uniqueRequestContext);
        throw new Error("Verification service failed to produce a result.");
    }
    // Handle error status returned by the verifier (e.g., Timelock Failed)
    if (verificationResult.finalVerdict.startsWith('Error:')) {
         console.warn(`[Controller] Verification completed with error status: ${verificationResult.finalVerdict}`);
         // Error already logged within performVerification via addStep
         // We will still return a 200 OK but include the error status in the payload
    } else {
        // Log successful completion calculation only if no error status from verifier
        await logRecallEvent(
            'FINAL_VERDICT_CALCULATED',
            {
                calculatedVerdict: verificationResult.finalVerdict,
                confidence: verificationResult.confidenceScore,
                usedCidsCount: verificationResult.usedFragmentCids.length,
                timelockRequestId: verificationResult.timelockRequestId,
            },
            uniqueRequestContext
        );
    }

    // Log completion of controller handling for this request
    await logRecallEvent('VERIFICATION_COMPLETE', { finalStatus: verificationResult.finalVerdict }, uniqueRequestContext);

    // --- 3. Prepare SUCCESS API Response Payload ---
    const recallTrace = await getTraceFromRecall(uniqueRequestContext); // Fetch trace for response
    const responsePayload: ApiVerifyResponse = {
        answer: finalAnswer,
        status: verificationResult.finalVerdict,
        confidence: verificationResult.confidenceScore,
        usedFragmentCids: verificationResult.usedFragmentCids,
        timelockRequestId: verificationResult.timelockRequestId,
        timelockTxExplorerUrl: verificationResult.timelockCommitTxHash
            ? getL2ExplorerUrl(verificationResult.timelockCommitTxHash) // Util handles undefined RPC/ChainID
            : undefined,
        recallTrace: recallTrace,
        // recallExplorerUrl: // TODO: Add if Recall provides one based on context/trace ID
    };

    console.log(`[Controller] Sending successful response for request ${uniqueRequestContext}`);
    res.status(200).json(responsePayload);

  } catch (error: any) {
    console.error(`[Controller Error Request: ${uniqueRequestContext}]:`, error.message);
    // Log the error that reached the controller catch block
    await logRecallEvent('VERIFICATION_ERROR', { controllerError: error.message, stack: error.stack?.substring(0, 300) }, uniqueRequestContext);

    // --- Prepare ERROR API Response Payload ---
    const recallTraceOnError = await getTraceFromRecall(uniqueRequestContext); // Attempt to get trace even on error
    const errorResponse: ApiVerifyResponse = {
        answer: finalAnswer === "Processing..." ? "Failed to process request." : finalAnswer, // Show generated answer if available
        status: verificationResult?.finalVerdict || 'Error: Verification Failed', // Show status if verifier ran partially
        error: 'Verification process encountered an error.', // Generic error for frontend
        details: error.message, // Specific error message
        recallTrace: recallTraceOnError // Include trace up to failure point
    };
    res.status(500).json(errorResponse);
  }
}
