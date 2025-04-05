// controllers/verifyController.ts
import { Request, Response, NextFunction } from 'express';
import { generateClaim } from '../services/generatorService';
import { performVerification } from '../services/verifierService';
import { logErrorEvent, getTraceFromRecall } from '../services/recallService';
import { VerificationResultInternal, ApiVerifyResponse, RecallLogEntryData } from '../types';
import { getL2ExplorerUrl, isValidCid } from '../utils'; // Import isValidCid

export async function handleVerifyRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { question, knowledgeBaseCid } = req.body; // Added knowledgeBaseCid
  const uniqueRequestContext = `req_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;

  // --- Validation ---
  if (!question || typeof question !== 'string' || question.trim() === '') {
     res.status(400).json({ error: 'Invalid request body: Missing or invalid "question".' }); return;
  }
  if (!knowledgeBaseCid || typeof knowledgeBaseCid !== 'string' || !isValidCid(knowledgeBaseCid)) { // Added CID validation
     res.status(400).json({ error: 'Invalid request body: Missing or invalid "knowledgeBaseCid".' }); return;
  }
  if (question.length > 1500) {
     res.status(400).json({ error: 'Question exceeds maximum length.' }); return;
  }
  // --- End Validation ---

  let verificationResult: VerificationResultInternal | null = null;
  let generatedClaim: string | undefined = "Processing...";

  console.log(`[Controller] Handling request ${uniqueRequestContext.substring(0, 15)}... | KB CID: ${knowledgeBaseCid.substring(0,10)}...`);
  try {
    // Pass knowledgeBaseCid to generator
    generatedClaim = await generateClaim(question, knowledgeBaseCid, uniqueRequestContext);
    if (typeof generatedClaim !== 'string') { throw new Error('Generator invalid type'); }
    if (generatedClaim.startsWith('Error:')) { throw new Error(`Claim Gen Failed: ${generatedClaim}`); }

    // Pass knowledgeBaseCid to verifier
    verificationResult = await performVerification(question, generatedClaim, knowledgeBaseCid, uniqueRequestContext);
    if (!verificationResult) { throw new Error("Verification service null result"); }
    if (verificationResult.finalVerdict.startsWith('Error:')) { console.warn(`[Controller] Verification status: ${verificationResult.finalVerdict}`); }

    // Prepare SUCCESS response
    const responsePayloadRaw: ApiVerifyResponse = {
      answer: generatedClaim,
      status: verificationResult.finalVerdict,
      confidence: verificationResult.confidenceScore,
      usedFragmentCids: verificationResult.usedFragmentCids, // Should reflect the passed CID now
      timelockRequestId: verificationResult.timelockRequestId,
      timelockTxExplorerUrl: verificationResult.timelockCommitTxHash ? getL2ExplorerUrl(verificationResult.timelockCommitTxHash) : undefined,
      recallTrace: verificationResult.reasoningSteps,
    };
    const responsePayload = Object.entries(responsePayloadRaw).reduce((acc, [key, value]) => { if (value !== undefined) { /* @ts-ignore */ acc[key] = value; } return acc; }, {} as Partial<ApiVerifyResponse>);

    console.log(`[Controller] Sending Response | Status: ${responsePayload.status}`);
    res.status(200).json(responsePayload);

  } catch (error: any) {
    const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error); console.error(`[Controller Error] ${conciseError}`);
    const finalAnswerInError = (typeof generatedClaim === 'string' && generatedClaim !== "Processing...") ? generatedClaim : "Failed";
    const finalStatusInError = verificationResult?.finalVerdict?.startsWith('Error:') ? verificationResult.finalVerdict : 'Error: Verification Failed';
    try { logErrorEvent({ controllerError: conciseError, stage: 'ControllerCatch' }, uniqueRequestContext).catch(/* ignore */); } catch { }

    // Error response
    const simpleErrorResponseRaw: Partial<ApiVerifyResponse> = { answer: finalAnswerInError, status: finalStatusInError, error: 'Verification error.', details: conciseError, confidence: verificationResult?.confidenceScore, timelockRequestId: verificationResult?.timelockRequestId, recallTrace: verificationResult?.reasoningSteps };
    const simpleErrorResponse = Object.entries(simpleErrorResponseRaw).reduce((acc, [key, value]) => { if (value !== undefined) { /*@ts-ignore*/ acc[key] = value; } return acc; }, {} as Partial<ApiVerifyResponse>);
    if (!res.headersSent) { res.status(500).json(simpleErrorResponse); } else { console.error(`[Controller Error] Headers already sent`); }
  }
}