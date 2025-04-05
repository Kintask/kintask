// services/verifierService.ts
import {
    VerificationResultInternal,
    RecallLogEntryData,
    RecallEventType,
    VerificationStatus
} from '../types';
import { fetchContentByCid } from './filecoinService'; // Changed import
import { commitVerdictTimelocked } from './timelockService';
import { logFinalVerificationTrace, logErrorEvent } from './recallService';
import { truncateText } from '../utils';
import config from '../config';
import { getVerificationFromLLM, LLMVerificationResult } from './generatorService';
import { ethers } from 'ethers';

type AgentVerdict = 'Supported' | 'Contradicted' | 'Neutral';
interface AgentVerificationResult {
    verdict: AgentVerdict; confidence: number; evidenceCid: string; agentId: string; explanation?: string;
}
const NUM_VERIFIER_AGENTS = 1; // Keep simple for now
const CONSENSUS_THRESHOLD = 0.6; // Not strictly needed for N=1

// addStep helper - PURELY LOCAL LOGGING
const addStep = (
    reasoningSteps: RecallLogEntryData[], requestContext: string, type: RecallEventType, details: Record<string, any>) => {
    if (!Array.isArray(reasoningSteps)) { console.error(`[addStep INTERNAL ERROR]`); return; }
    const timestamp = new Date().toISOString();
    // Basic truncation for log details to avoid excessive length
    const truncatedDetails = Object.entries(details).reduce((acc, [key, value]) => {
        try {
            acc[key] = typeof value === 'string' ? truncateText(value, 200) : value;
        } catch (e) { acc[key] = '[Truncation Error]'; }
        return acc;
    }, {} as Record<string, any>);
    const stepData: RecallLogEntryData = { timestamp, type, details: truncatedDetails, requestContext };
    reasoningSteps.push(stepData);
};

// LLM Verifier Agent - Now accepts paper content and CID
async function LLMVerifierAgent(
    claim: string,
    paperContent: string, // <-- Added
    paperCid: string, // <-- Added
    agentId: string,
    requestContext: string,
    reasoningSteps: RecallLogEntryData[]
): Promise<{ success: boolean; result?: AgentVerificationResult; error?: string; agentId: string }> { // Added agentId to return
    if (!Array.isArray(reasoningSteps)) { console.error("[Verifier Agent INTERNAL ERROR]"); return { success: false, error:"Internal error: reasoningSteps array missing.", agentId }; }
    addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'VerifierAgentStart', agentId });

    try {
        // Prepare excerpt from provided content
        const relevantText = `Abstract (first 1500 chars):\n${paperContent.substring(0, 1500)}\n\nConclusion (last 1500 chars):\n${paperContent.substring(Math.max(0, paperContent.length - 1500))}`;
        addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'VerifierAgentLLMCall', agentId, excerptLength: relevantText.length });

        // Call LLM with the excerpt
        const llmResult: LLMVerificationResult = await getVerificationFromLLM(claim, relevantText, requestContext, agentId);

        // Use the provided paperCid as evidence
        const result: AgentVerificationResult = {
             verdict: llmResult.verdict,
             confidence: llmResult.confidence,
             evidenceCid: paperCid, // Use the passed CID
             agentId: agentId,
             explanation: llmResult.explanation
         };

        addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'VerifierAgentComplete', agentId, verdict: result.verdict, confidence: result.confidence, explanation: result.explanation });
        console.log(`[Verifier Agent ${agentId} DEBUG] Finished successfully. Verdict: ${result.verdict}`);
        return { success: true, result: result, agentId };
    } catch (error: any) {
        const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.error(`[Verifier Agent ${agentId} Error] ${conciseError}`);
        addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'VerifierAgentExecution', agentId, error: conciseError });
        // Log critical agent error to Recall
        logErrorEvent({ stage: 'VerifierAgentExecution', agentId, error: conciseError }, requestContext).catch(/* ignore background log fail */);
        return { success: false, error: conciseError, agentId };
     }
}


// --- Main Verification Logic Function ---
export async function performVerification(
    question: string,
    initialClaim: string,
    knowledgeBaseCid: string, // Added knowledgeBaseCid
    requestContext: string
): Promise<VerificationResultInternal | null> {

    console.log(`[Verifier Service] Starting verification | Context: ${requestContext.substring(0,10)}... | KB CID: ${knowledgeBaseCid.substring(0,10)}...`);
    const reasoningSteps: RecallLogEntryData[] = []; // Initialize local log array
    let finalEvidenceCids: string[] = []; let finalVerdict: VerificationStatus = 'Unverified'; let finalConfidence = 0.0;
    let timelockDetails: Awaited<ReturnType<typeof commitVerdictTimelocked>> = null;

    addStep(reasoningSteps, requestContext, 'VERIFICATION_START', { inputQuestion: truncateText(question, 100), initialClaim: truncateText(initialClaim, 100), knowledgeBaseCid: knowledgeBaseCid });

    try {
        addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AnalyzeInput' });

        // Fetch content using the provided CID
        addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_ATTEMPT', { stage: 'PaperContent', cid: knowledgeBaseCid });
        const paperText = await fetchContentByCid(knowledgeBaseCid); // Use new function

        if (!paperText) {
            const errorMsg = `Failed to fetch content from CID: ${knowledgeBaseCid.substring(0,10)}...`;
            addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'PaperFetch', error: errorMsg });
            finalVerdict = 'Error: Verification Failed';
            finalConfidence = 0;
            finalEvidenceCids = [knowledgeBaseCid]; // Include the CID even on failure
        } else {
            addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_SUCCESS', { cid: knowledgeBaseCid, length: paperText.length });
            finalEvidenceCids = [knowledgeBaseCid]; // Set the evidence CID early

            // Simulate Verifier Agents (N=1 for now)
            const verifierPromises = [];
            addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'SimulateVerifierAgentsLLM', count: NUM_VERIFIER_AGENTS });
            for (let i = 1; i <= NUM_VERIFIER_AGENTS; i++) {
                // Pass paperText and knowledgeBaseCid to the agent
                verifierPromises.push(
                     LLMVerifierAgent(initialClaim, paperText, knowledgeBaseCid, `verifier_${i}`, requestContext, reasoningSteps)
                );
            }
            const settledResults = await Promise.allSettled(verifierPromises);

            // Aggregate Results
            addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AggregateResultsLLM' });
            const successfulResults: AgentVerificationResult[] = [];
            settledResults.forEach((pResult, index) => {
                 if (pResult.status === 'fulfilled' && pResult.value.success && pResult.value.result) {
                    successfulResults.push(pResult.value.result);
                 } else {
                    const agentId = (pResult.status === 'fulfilled' ? pResult.value.agentId : `verifier_${index+1}`);
                    const errorReason = (pResult.status === 'rejected' ? pResult.reason?.message : pResult.value?.error) || 'Unknown failure';
                    addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'VerifierCompletion', agentId: agentId, error: truncateText(errorReason, 150) });
                 }
             });
            const successfulAgentsCount = successfulResults.length;

            // Simplified Aggregation Logic for N=1
            if (successfulAgentsCount < 1) {
                finalVerdict = 'Flagged: Uncertain'; // Or 'Error: Verification Failed' if needed
                finalConfidence = 0.1; // Low confidence if agent failed
            } else {
                const r = successfulResults[0]; // Only one result for N=1
                if (r.verdict === 'Supported') finalVerdict = 'Verified';
                else if (r.verdict === 'Contradicted') finalVerdict = 'Flagged: Contradictory';
                else finalVerdict = 'Unverified'; // Neutral case
                finalConfidence = r.confidence;
                // finalEvidenceCids is already set
            }
            const verdictDetails = { step: 'AggregationComplete', aggregatedVerdict: finalVerdict, aggregatedConfidence: finalConfidence.toFixed(2), successfulAgents: successfulAgentsCount, totalAgents: NUM_VERIFIER_AGENTS };
            addStep(reasoningSteps, requestContext, 'REASONING_STEP', verdictDetails);
        }

        // Timelock Commit (Only if no major error occurred before)
        if (config.kintaskContractAddress && config.blocklockSenderProxyAddress && !finalVerdict.startsWith('Error:')) {
            addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_ATTEMPT', { verdictToCommit: finalVerdict });
            timelockDetails = await commitVerdictTimelocked(finalVerdict, 5, requestContext); // Default 5 block delay
            if (timelockDetails) {
                 addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_SUCCESS', { requestId: timelockDetails.requestId, txHash: timelockDetails.txHash, ciphertextHash: timelockDetails.ciphertextHash });
            } else {
                 addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'commitVerdictTimelocked returned null' });
                 finalVerdict = 'Error: Timelock Failed'; // Downgrade status if timelock fails
                 finalConfidence = 0;
             }
        } else if (!finalVerdict.startsWith('Error:')) {
             addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'Timelock/Contract not configured in .env' });
        } else {
             addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'Skipped due to prior error', priorVerdict: finalVerdict });
        }

        // Final Result Object Construction
        addStep(reasoningSteps, requestContext, 'VERIFICATION_COMPLETE', { finalStatus: finalVerdict, finalConfidence: finalConfidence.toFixed(2) });
        const finalResult: VerificationResultInternal = {
            finalVerdict: finalVerdict,
            confidenceScore: parseFloat(finalConfidence.toFixed(2)),
            usedFragmentCids: finalEvidenceCids,
            reasoningSteps: reasoningSteps, // Include local steps
            timelockRequestId: timelockDetails?.requestId,
            timelockCommitTxHash: timelockDetails?.txHash,
            ciphertextHash: timelockDetails?.ciphertextHash
        };

        // --- FINAL BATCH RECALL LOG ---
        console.log(`[Verifier Service] Attempting FINAL BATCH log | Steps: ${reasoningSteps.length}`);
        await logFinalVerificationTrace(requestContext, finalResult)
             .then(txHash => { if(txHash) console.log(`[Verifier Service] Final batch logged | Tx: ${txHash.substring(0,15)}...`); })
             .catch(err => console.error(`[Verifier Service] FAILED final batch log: ${err.message}`));

        console.log(`[Verifier Service] Verification complete | Verdict: ${finalResult.finalVerdict}`);
        return finalResult; // Return object containing local reasoningSteps

    } catch (error: any) {
        const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.error(`[Verifier Service Error - Top Level] ${conciseError}`);
        addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { error: conciseError, stage: 'TopLevelCatch' });
        // Ensure CID is included in error result if available
        if (knowledgeBaseCid && finalEvidenceCids.length === 0) finalEvidenceCids.push(knowledgeBaseCid);
        const errorResult: VerificationResultInternal = {
            finalVerdict: 'Error: Verification Failed',
            confidenceScore: 0,
            usedFragmentCids: finalEvidenceCids,
            reasoningSteps: reasoningSteps,
            timelockRequestId: timelockDetails?.requestId, // Include if commit happened before crash
            timelockCommitTxHash: timelockDetails?.txHash
         };
        try { await logFinalVerificationTrace(requestContext, errorResult); } catch {} // Log error batch
        return errorResult;
     }
}