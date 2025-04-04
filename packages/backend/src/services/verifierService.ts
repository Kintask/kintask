// services/verifierService.ts
import {
    VerificationResultInternal,
    RecallLogEntryData,
    RecallEventType,
    VerificationStatus
} from '../types';
import { fetchKnowledgeSourceContent } from './filecoinService';
import { commitVerdictTimelocked } from './timelockService';
// --- Import ONLY the final batch log function ---
import { logFinalVerificationTrace, logErrorEvent } from './recallService'; // Keep logErrorEvent for critical agent fails
import { truncateText } from '../utils';
import config from '../config';
import { getVerificationFromLLM, LLMVerificationResult } from './generatorService';
import { ethers } from 'ethers';

type AgentVerdict = 'Supported' | 'Contradicted' | 'Neutral';
interface AgentVerificationResult {
    verdict: AgentVerdict; confidence: number; evidenceCid: string; agentId: string; explanation?: string;
}
const NUM_VERIFIER_AGENTS = 1;
const CONSENSUS_THRESHOLD = 0.6;

// addStep helper - PURELY LOCAL LOGGING
const addStep = (
    reasoningSteps: RecallLogEntryData[], requestContext: string, type: RecallEventType, details: Record<string, any>) => {
    if (!Array.isArray(reasoningSteps)) { console.error(`[addStep INTERNAL ERROR]`); return; }
    const timestamp = new Date().toISOString();
    const truncatedDetails = Object.entries(details).reduce((acc, [key, value]) => {
        try { /* ... truncation ... */ } catch (e) { /* ... */ } return acc;
    }, {} as Record<string, any>);
    const stepData: RecallLogEntryData = { timestamp, type, details: truncatedDetails, requestContext };
    reasoningSteps.push(stepData);
};

// LLM Verifier Agent - PURELY LOCAL LOGGING via addStep
async function LLMVerifierAgent(
    claim: string, paperContent: string, agentId: string, requestContext: string, reasoningSteps: RecallLogEntryData[]
): Promise<{ success: boolean; result?: AgentVerificationResult; error?: string }> {
    if (!Array.isArray(reasoningSteps)) { /* ... */ return { success: false, error:"Internal error", agentId }; }
    addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'VerifierAgentStart', agentId }); // Log locally
    const paperCid = config.knowledgeBaseIndexCid || 'unknown_cid';
    try {
        const relevantText = `Abstract:\n${paperContent.substring(0, 1500)}\n\nConclusion:\n${paperContent.substring(Math.max(0, paperContent.length - 1500))}`;
        addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'VerifierAgentLLMCall', agentId }); // Log locally
        const llmResult: LLMVerificationResult = await getVerificationFromLLM(claim, relevantText, requestContext, agentId);
        const result: AgentVerificationResult = { verdict: llmResult.verdict, confidence: llmResult.confidence, evidenceCid: paperCid, agentId: agentId, explanation: llmResult.explanation };
        addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'VerifierAgentComplete', agentId, verdict: result.verdict, /*...*/ }); // Log locally
        // --- NO Recall Log here ---
        console.log(`[Verifier Agent ${agentId} DEBUG] Finished successfully.`);
        return { success: true, result: result };
    } catch (error: any) {
        const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.error(`[Verifier Agent ${agentId} Error] ${conciseError}`);
        addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'VerifierAgentExecution', agentId, error: conciseError }); // Log locally
        // --- Log critical agent error to Recall ---
        logErrorEvent({ stage: 'VerifierAgentExecution', agentId, error: conciseError }, requestContext).catch(/* ignore background log fail */);
        return { success: false, error: conciseError, agentId };
     }
}


// --- Main Verification Logic Function ---
export async function performVerification(
    question: string, initialClaim: string, requestContext: string
): Promise<VerificationResultInternal | null> {

    console.log(`[Verifier Service] Starting verification | Context: ${requestContext.substring(0,10)}...`);
    const reasoningSteps: RecallLogEntryData[] = []; // Initialize local log array
    let finalEvidenceCids: string[] = []; let finalVerdict: VerificationStatus = 'Unverified'; let finalConfidence = 0.0;
    let timelockDetails: Awaited<ReturnType<typeof commitVerdictTimelocked>> = null;

    addStep(reasoningSteps, requestContext, 'VERIFICATION_START', { inputQuestion: truncateText(question, 100), initialClaim: truncateText(initialClaim, 100) });

    try {
        addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AnalyzeInput' });
        addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_ATTEMPT', { stage: 'PaperContent' });
        const paperText = await fetchKnowledgeSourceContent();

        if (!paperText) {
            addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'PaperFetch', error: 'Failed' });
            finalVerdict = 'Error: Verification Failed';
        } else {
            addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_SUCCESS', { /* ... */ });
            const paperCid = config.knowledgeBaseIndexCid || 'unknown_cid';
            const verifierPromises = [];
            addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'SimulateVerifierAgentsLLM', count: NUM_VERIFIER_AGENTS });
            for (let i = 1; i <= NUM_VERIFIER_AGENTS; i++) { verifierPromises.push( LLMVerifierAgent(initialClaim, paperText, `verifier_${i}`, requestContext, reasoningSteps) ); }
            const settledResults = await Promise.allSettled(verifierPromises);

            addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AggregateResultsLLM' });
            const successfulResults: AgentVerificationResult[] = [];
            settledResults.forEach((pResult, index) => { if (pResult.status === 'fulfilled' && pResult.value.success && pResult.value.result) { successfulResults.push(pResult.value.result); } else { addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'VerifierCompletion', /* ... */ }); } });
            const successfulAgentsCount = successfulResults.length;

            // Aggregation Logic
            if (successfulAgentsCount < 1) { /*...*/ finalVerdict = 'Flagged: Uncertain'; finalConfidence = 0.1; finalEvidenceCids = [paperCid]; }
            else { /* Simplified for N=1 */ const r = successfulResults[0]; if (r.verdict === 'Supported') finalVerdict = 'Verified'; else if (r.verdict === 'Contradicted') finalVerdict = 'Flagged: Contradictory'; else finalVerdict = 'Unverified'; finalConfidence = r.confidence; finalEvidenceCids = [r.evidenceCid];}
            const verdictDetails = { step: 'AggregationComplete', aggregatedVerdict: finalVerdict, aggregatedConfidence: finalConfidence.toFixed(2), successfulAgents: successfulAgentsCount };
            addStep(reasoningSteps, requestContext, 'REASONING_STEP', verdictDetails); // Log locally
            // NO Recall log here for intermediate verdict
        }

        // Timelock Commit (use addStep locally)
        if (config.kintaskContractAddress && config.blocklockSenderProxyAddress) {
            addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_ATTEMPT', { verdictToCommit: finalVerdict });
             if (!finalVerdict.startsWith('Error:')) {
                 timelockDetails = await commitVerdictTimelocked(finalVerdict, 5, requestContext);
                 if (timelockDetails) { addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_SUCCESS', { /*...*/ }); }
                 else { addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { /*...*/ }); finalVerdict = 'Error: Timelock Failed'; finalConfidence = 0;}
             } else { addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { /*...*/ }); }
        } else { addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { /*...*/ }); }

        // Final Result Object Construction
        addStep(reasoningSteps, requestContext, 'VERIFICATION_COMPLETE', { finalStatus: finalVerdict }); // Log completion locally
        const finalResult: VerificationResultInternal = {
            finalVerdict: finalVerdict, confidenceScore: parseFloat(finalConfidence.toFixed(2)), usedFragmentCids: finalEvidenceCids,
            reasoningSteps: reasoningSteps, // Include local steps
            timelockRequestId: timelockDetails?.requestId, timelockCommitTxHash: timelockDetails?.txHash, ciphertextHash: timelockDetails?.ciphertextHash };

        // --- FINAL BATCH RECALL LOG ---
        console.log(`[Verifier Service] Attempting FINAL BATCH log | Steps: ${reasoningSteps.length}`);
        await logFinalVerificationTrace(requestContext, finalResult) // Use dedicated batch function
             .then(txHash => { if(txHash) console.log(`[Verifier Service] Final batch logged | Tx: ${txHash.substring(0,15)}...`); })
             .catch(err => console.error(`[Verifier Service] FAILED final batch log: ${err.message}`));

        console.log(`[Verifier Service] Verification complete | Verdict: ${finalResult.finalVerdict}`);
        return finalResult; // Return object containing local reasoningSteps

    } catch (error: any) {
        const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.error(`[Verifier Service Error - Top Level] ${conciseError}`);
        addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { error: conciseError, stage: 'TopLevelCatch' });
        const errorResult: VerificationResultInternal = { finalVerdict: 'Error: Verification Failed', confidenceScore: 0, usedFragmentCids: finalEvidenceCids, reasoningSteps: reasoningSteps, /*...*/ };
        try { await logFinalVerificationTrace(requestContext, errorResult); } catch {} // Log error batch
        return errorResult;
     }
}