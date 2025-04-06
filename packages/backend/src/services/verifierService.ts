// src/services/verifierService.ts
import {
    VerificationResultInternal,
    RecallLogEntryData,
    RecallEventType,
    VerificationStatus
} from '../types'; // Import types
import { fetchContentByCid } from './filecoinService';
import { commitVerdictTimelocked } from './timelockService';
// Import logFinalVerificationTrace if used, ensure it's exported from recallService
import { logErrorEvent, logFinalVerificationTrace } from './recallService';
import { truncateText } from '../utils'; // Ensure truncateText is imported
import config from '../config';
import { getVerificationFromLLM, LLMVerificationResult } from './generatorService';
import { ethers } from 'ethers'; // Keep if needed, otherwise remove

type AgentVerdict = 'Supported' | 'Contradicted' | 'Neutral';
interface AgentVerificationResult {
    verdict: AgentVerdict; confidence: number; evidenceCid: string; agentId: string; explanation?: string;
}
const NUM_VERIFIER_AGENTS = 1; // Number of agents simulated in this synchronous flow
const CONSENSUS_THRESHOLD = 0.6; // Not strictly used for N=1

// addStep helper - PURELY LOCAL LOGGING for the synchronous verification flow
const addStep = (
    reasoningSteps: RecallLogEntryData[], requestContext: string, type: RecallEventType, details: Record<string, any>) => {
    if (!Array.isArray(reasoningSteps)) { console.error(`[addStep INTERNAL ERROR]`); return; }
    const timestamp = new Date().toISOString();
    const truncatedDetails = Object.entries(details).reduce((acc, [key, value]) => {
        try {
            acc[key] = typeof value === 'string' ? truncateText(value, 200) : value;
        } catch (e) { acc[key] = '[Truncation Error]'; }
        return acc;
    }, {} as Record<string, any>);
    // Ensure the provided 'type' is a valid RecallEventType before casting
    const stepData: RecallLogEntryData = { timestamp, type: type as RecallEventType, details: truncatedDetails, requestContext };
    reasoningSteps.push(stepData);
};

// LLM Verifier Agent simulation within the synchronous flow
async function LLMVerifierAgent(
    claim: string,
    paperContent: string,
    paperCid: string,
    agentId: string,
    requestContext: string,
    reasoningSteps: RecallLogEntryData[] // Pass array to log steps
): Promise<{ success: boolean; result?: AgentVerificationResult; error?: string; agentId: string }> { // Added agentId to return
    if (!Array.isArray(reasoningSteps)) { return { success: false, error:"Internal error: reasoningSteps missing.", agentId }; }
    // Use valid RecallEventType values from the updated types/index.ts
    addStep(reasoningSteps, requestContext, 'AGENT_JOB_START', { step: 'VerifierAgentStart', agentId }); // Use a valid event type
    try {
        const relevantText = `Abstract (first 1500 chars):\n${paperContent.substring(0, 1500)}\n\nConclusion (last 1500 chars):\n${paperContent.substring(Math.max(0, paperContent.length - 1500))}`;
        addStep(reasoningSteps, requestContext, 'AGENT_LLM_CALL_START', { step: 'VerifierAgentLLMCall', agentId, excerptLength: relevantText.length }); // Use valid event type

        const llmResult: LLMVerificationResult = await getVerificationFromLLM(claim, relevantText, requestContext, agentId);

        const result: AgentVerificationResult = { verdict: llmResult.verdict, confidence: llmResult.confidence, evidenceCid: paperCid, agentId: agentId, explanation: llmResult.explanation };

        addStep(reasoningSteps, requestContext, 'AGENT_JOB_COMPLETE', { step: 'VerifierAgentComplete', agentId, verdict: result.verdict, confidence: result.confidence, explanation: result.explanation }); // Use valid event type
        console.log(`[Verifier Agent ${agentId} DEBUG] Finished successfully. Verdict: ${result.verdict}`);
        return { success: true, result: result, agentId };
    } catch (error: any) {
        const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.error(`[Verifier Agent ${agentId} Error] ${conciseError}`);
        addStep(reasoningSteps, requestContext, 'AGENT_ERROR', { stage: 'VerifierAgentExecution', agentId, error: conciseError }); // Use valid event type
        // Log critical agent error to Recall
        logErrorEvent({ stage: 'VerifierAgentExecution', agentId, error: conciseError }, requestContext).catch(/* ignore background log fail */);
        return { success: false, error: conciseError, agentId };
     }
}


// --- Main Synchronous Verification Logic Function ---
// This function is called by the verifyController for the /verify endpoint.
export async function performVerification(
    question: string,
    initialClaim: string,
    knowledgeBaseCid: string,
    requestContext: string
): Promise<VerificationResultInternal | null> {

    console.log(`[Verifier Service] Starting sync verification | Context: ${requestContext.substring(0,10)}... | KB CID: ${knowledgeBaseCid.substring(0,10)}...`);
    const reasoningSteps: RecallLogEntryData[] = []; // Local log array for this specific request
    let finalEvidenceCids: string[] = [];
    let finalVerdict: VerificationStatus = 'Unverified'; // Default status
    let finalConfidence = 0.0;
    let timelockDetails: Awaited<ReturnType<typeof commitVerdictTimelocked>> = null;

    // Use valid RecallEventType values for addStep calls
    addStep(reasoningSteps, requestContext, 'VERIFICATION_START', { inputQuestion: truncateText(question, 100), initialClaim: truncateText(initialClaim, 100), knowledgeBaseCid: knowledgeBaseCid });

    try {
        addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AnalyzeInput' });
        addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_ATTEMPT', { stage: 'PaperContent', cid: knowledgeBaseCid });
        const paperText = await fetchContentByCid(knowledgeBaseCid);

        if (!paperText) {
            const errorMsg = `Failed to fetch content from CID: ${knowledgeBaseCid.substring(0,10)}...`;
            addStep(reasoningSteps, requestContext, 'AGENT_KB_FETCH_FAILURE', { stage: 'PaperFetch', error: errorMsg }); // Use valid type
            finalVerdict = 'Error: Verification Failed';
            finalConfidence = 0;
            finalEvidenceCids = [knowledgeBaseCid];
        } else {
            addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_SUCCESS', { cid: knowledgeBaseCid, length: paperText.length });
            finalEvidenceCids = [knowledgeBaseCid];

            const verifierPromises = [];
            addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'SimulateVerifierAgentsLLM', count: NUM_VERIFIER_AGENTS });
            for (let i = 1; i <= NUM_VERIFIER_AGENTS; i++) {
                verifierPromises.push( LLMVerifierAgent(initialClaim, paperText, knowledgeBaseCid, `verifier_${i}`, requestContext, reasoningSteps) );
            }
            const settledResults = await Promise.allSettled(verifierPromises);

            addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AggregateResultsLLM' });
            const successfulResults: AgentVerificationResult[] = [];
            settledResults.forEach((pResult, index) => {
                 if (pResult.status === 'fulfilled' && pResult.value.success && pResult.value.result) {
                    successfulResults.push(pResult.value.result);
                 } else {
                    const agentId = (pResult.status === 'fulfilled' ? pResult.value.agentId : `verifier_${index+1}`);
                    const errorReason = (pResult.status === 'rejected' ? pResult.reason?.message : pResult.value?.error) || 'Unknown failure';
                    addStep(reasoningSteps, requestContext, 'AGENT_ERROR', { stage: 'VerifierCompletion', agentId: agentId, error: truncateText(errorReason, 150) }); // Use valid type
                 }
             });
            const successfulAgentsCount = successfulResults.length;

            // Use valid VerificationStatus types
            if (successfulAgentsCount < 1) {
                finalVerdict = 'Flagged: Uncertain'; // Use valid status from types
                finalConfidence = 0.1;
            } else {
                const r = successfulResults[0];
                if (r.verdict === 'Supported') finalVerdict = 'Verified';
                else if (r.verdict === 'Contradicted') finalVerdict = 'Flagged: Contradictory';
                else finalVerdict = 'Unverified'; // Neutral case
                finalConfidence = r.confidence;
            }
            const verdictDetails = { step: 'AggregationComplete', aggregatedVerdict: finalVerdict, aggregatedConfidence: finalConfidence.toFixed(2), successfulAgents: successfulAgentsCount, totalAgents: NUM_VERIFIER_AGENTS };
            addStep(reasoningSteps, requestContext, 'REASONING_STEP', verdictDetails);
        }

        // Timelock Commit
        if (config.kintaskContractAddress && config.blocklockSenderProxyAddress && !finalVerdict.startsWith('Error:')) {
            addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_ATTEMPT', { verdictToCommit: finalVerdict });
            timelockDetails = await commitVerdictTimelocked(finalVerdict, 5, requestContext);
            if (timelockDetails) {
                 addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_SUCCESS', { requestId: timelockDetails.requestId, txHash: timelockDetails.txHash, ciphertextHash: timelockDetails.ciphertextHash });
            } else {
                 addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'commitVerdictTimelocked returned null' });
                 finalVerdict = 'Error: Timelock Failed'; // Use valid status
                 finalConfidence = 0;
             }
        } else if (!finalVerdict.startsWith('Error:')) {
             addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'Timelock/Contract not configured in .env' });
        } else {
             addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'Skipped due to prior error', priorVerdict: finalVerdict });
        }

        // Final Result Object Construction
        addStep(reasoningSteps, requestContext, 'VERIFICATION_COMPLETE', { finalStatus: finalVerdict, finalConfidence: finalConfidence.toFixed(2) });
        // Ensure properties match VerificationResultInternal interface
        const finalResult: VerificationResultInternal = {
            finalVerdict: finalVerdict,
            confidenceScore: parseFloat(finalConfidence.toFixed(2)),
            usedFragmentCids: finalEvidenceCids,
            reasoningSteps: reasoningSteps, // Assign collected steps
            timelockRequestId: timelockDetails?.requestId,
            timelockCommitTxHash: timelockDetails?.txHash,
            ciphertextHash: timelockDetails?.ciphertextHash
            // aggregationTxHash is not set in this flow
        };

        // Log final batch trace to Recall if function exists/intended
        console.log(`[Verifier Service] Attempting FINAL BATCH log for sync flow | Steps: ${reasoningSteps.length}`);
        await logFinalVerificationTrace(requestContext, finalResult)
             // Add explicit types for callbacks
             .then((txHash: string | undefined) => {
                 if(txHash) console.log(`[Verifier Service] Final batch logged | Tx: ${txHash.substring(0,15)}...`);
             })
             .catch((err: Error) => { // Catch specifically Error type
                console.error(`[Verifier Service] FAILED final batch log: ${err.message}`)
             });

        console.log(`[Verifier Service] Sync verification complete | Verdict: ${finalResult.finalVerdict}`);
        return finalResult;

    } catch (error: any) {
        const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.error(`[Verifier Service Error - Top Level Sync] ${conciseError}`);
        addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { error: conciseError, stage: 'TopLevelCatchSync' }); // Use VERIFICATION_ERROR type
        if (knowledgeBaseCid && finalEvidenceCids.length === 0) finalEvidenceCids.push(knowledgeBaseCid);
        // Construct error result, including steps collected before crash
        const errorResult: VerificationResultInternal = {
            finalVerdict: 'Error: Verification Failed',
            confidenceScore: 0,
            usedFragmentCids: finalEvidenceCids,
            reasoningSteps: reasoningSteps, // Include steps
            timelockRequestId: timelockDetails?.requestId,
            timelockCommitTxHash: timelockDetails?.txHash,
            ciphertextHash: timelockDetails?.ciphertextHash
         };
        try { await logFinalVerificationTrace(requestContext, errorResult); }
        catch (logErr: any) { console.error("Failed to log error trace:", logErr.message); }
        return errorResult; // Return error result object
     }
}
// ==== ./src/services/verifierService.ts ====