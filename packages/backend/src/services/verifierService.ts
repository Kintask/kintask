import {
    KnowledgeFragment,
    VerificationResultInternal,
    RecallLogEntryData,
    RecallEventType,
    VerificationStatus
} from '../types';
import { fetchKnowledgeFragment, getKnowledgeIndex } from './filecoinService';
import { commitVerdictTimelocked } from './timelockService';
import { logRecallEvent } from './recallService';
import { truncateText } from '../utils'; // Import utility
import config from '../config'; // Import config to check if timelock is configured

// --- Helper Function ---
const addStep = async (
    reasoningSteps: RecallLogEntryData[],
    requestContext: string,
    type: RecallEventType,
    details: Record<string, any>
) => {
    const timestamp = new Date().toISOString();
    // Simple truncation for potentially large values in logs
    const truncatedDetails = Object.entries(details).reduce((acc, [key, value]) => {
        try {
            if (typeof value === 'string') {
                acc[key] = truncateText(value, 250); // Truncate long strings
            } else if (Array.isArray(value) && value.length > 15) {
                 acc[key] = value.slice(0, 15).concat(['...truncated...']); // Truncate long arrays
            } else if (key === 'stack') { // Don't stringify stack traces if too long
                 acc[key] = truncateText(value?.toString(), 300);
            } else if (typeof value === 'object' && value !== null && JSON.stringify(value).length > 300) {
                 acc[key] = { _truncated: true, keys: Object.keys(value).slice(0,5) }; // Truncate large objects
            } else if (typeof value === 'bigint') {
                 acc[key] = value.toString(); // Convert BigInts
            }
            else {
                acc[key] = value;
            }
        } catch (e) {
             acc[key] = `<<Error truncating value for key ${key}>>`; // Handle potential errors during truncation/stringification
        }
        return acc;
    }, {} as Record<string, any>);

    const stepData: RecallLogEntryData = { timestamp, type, details: truncatedDetails, requestContext };
    reasoningSteps.push(stepData);
    // Fire-and-forget logging to Recall
    logRecallEvent(type, truncatedDetails, requestContext).catch(err => {
        console.error(`[Verifier Service] Background logging to Recall failed for type ${type}:`, err.message);
    });
};


// --- Main Verification Logic Function ---
export async function performVerification(
    question: string,
    answer: string,
    requestContext: string // Identifier for this specific verification task
): Promise<VerificationResultInternal | null> {

    console.log(`[Verifier Service] Starting verification for context: ${requestContext}`);
    const reasoningSteps: RecallLogEntryData[] = [];
    let usedFragmentCids: string[] = []; // Track CIDs successfully fetched AND used in logic
    let preliminaryVerdict: VerificationStatus = 'Unverified';
    let confidenceScore = 0.5; // Start neutral
    let timelockDetails: Awaited<ReturnType<typeof commitVerdictTimelocked>> = null;

    try {
        // --- Step 1: Input Analysis & Keyword Extraction ---
        const questionLower = question.toLowerCase();
        const answerLower = answer.toLowerCase();
        const stopWords = new Set(['the', 'a', 'an', 'is', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'what', 'who', 'where', 'when', 'why', 'how', 'tell', 'me', 'about', 'can', 'you', 'please', 'i', 'it', 'my', 'your']);
        const keywords = [...new Set(
            questionLower.split(/\s+/) // Split by whitespace
                .map(word => word.replace(/[^\w]/g, '').trim()) // Remove punctuation
                .filter(word => word.length >= 3 && !stopWords.has(word)) // Filter length and stopwords
        )];
        await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AnalyzeInput', extractedKeywords: keywords });

        // --- Step 2: Fetch Index & Relevant CIDs ---
        await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_ATTEMPT', { stage: 'Index', keywords });
        const index = await getKnowledgeIndex(); // Fetches from cache or network
        let relevantCids: string[] = [];
        if (index) {
            keywords.forEach(kw => {
                if (index[kw]) relevantCids.push(...index[kw]);
            });
            relevantCids = [...new Set(relevantCids)]; // Deduplicate CIDs
            await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_SUCCESS', { stage: 'Index', foundCidsCount: relevantCids.length });
        } else {
            await addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'IndexFetch', error: 'Failed to retrieve knowledge index' });
             console.error("[Verifier Service] Failed to retrieve knowledge index. Verification quality may be reduced.");
             // Decide whether to throw or continue. Let's continue for robustness.
        }

        // Limit number of fragments to fetch/process for performance in MVP
        const MAX_FRAGMENTS_TO_PROCESS = 10;
        const cidsToFetch = relevantCids.slice(0, MAX_FRAGMENTS_TO_PROCESS);
        if (relevantCids.length > MAX_FRAGMENTS_TO_PROCESS) {
             await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { warning: 'Too many relevant fragments found', count: relevantCids.length, processingLimit: MAX_FRAGMENTS_TO_PROCESS });
        }


        // --- Step 3: Fetch KG Fragments Concurrently ---
        await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_ATTEMPT', { stage: 'Fragments', cidsToFetchCount: cidsToFetch.length });
        const fetchPromises = cidsToFetch.map(cid =>
            fetchKnowledgeFragment(cid).then(fragment => ({ cid, fragment }))
        );
        const fetchedResults = await Promise.all(fetchPromises);

        const fetchedFragments: KnowledgeFragment[] = [];
        const successfullyFetchedCids = new Set<string>();
        const failedFetches: string[] = [];
        fetchedResults.forEach(result => {
            if (result.fragment) {
                fetchedFragments.push(result.fragment);
                successfullyFetchedCids.add(result.cid);
            } else {
                failedFetches.push(result.cid);
            }
        });
        await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_SUCCESS', { stage: 'Fragments', fetchedCount: fetchedFragments.length, failedCidsCount: failedFetches.length });


        // --- Step 4: Apply Verification Logic ---
        if (fetchedFragments.length === 0 && relevantCids.length > 0) {
             // If index found CIDs but fetching failed for all relevant ones
             console.warn(`[Verifier Service] No relevant knowledge fragments could be fetched for context ${requestContext}, although index suggested ${relevantCids.length}.`);
             await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { warning: 'No fragments fetched despite finding relevant CIDs', failedCids });
             preliminaryVerdict = 'Unverified'; // Cannot verify without data
             confidenceScore = 0.1; // Very low confidence
        } else if (fetchedFragments.length === 0 && relevantCids.length === 0) {
             // If index found no relevant CIDs
              console.log(`[Verifier Service] No relevant knowledge fragments found in index for context ${requestContext}.`);
              await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { info: 'No relevant fragments found in index' });
              preliminaryVerdict = 'Unverified';
              confidenceScore = 0.3; // Slightly higher confidence than fetch failure
        }
        else {
            // Apply logic only if fragments were fetched
            await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'ApplyVerificationLogic', fragmentCount: fetchedFragments.length });
            let supportingScore = 0;
            let contradictingScore = 0;
            let uncertaintyFlags = 0;
            let provenanceIssues = 0;
            const fragmentsUsedInLogic: string[] = [];

            for (const fragment of fetchedFragments) {
                const fragmentId = fragment.fragment_id || `cid:${fragment.previous_version_cid?.substring(0, 8) ?? truncateText([...successfullyFetchedCids][fragmentsUsedInLogic.length], 8)}`;
                fragmentsUsedInLogic.push(fragmentId);

                try {
                    const fragmentConf = fragment.provenance?.confidence_score ?? 0.7;

                    // A) Uncertainty Check
                    if (fragmentConf < 0.4) {
                        uncertaintyFlags++;
                        await addStep(reasoningSteps, requestContext, 'PROVENANCE_CHECK', { check: 'LowConfidenceSource', fragmentId, score: fragmentConf });
                    }

                    // B) Fact Matching Logic (Simple Placeholder)
                    if (fragment.type === 'factual_statement' && fragment.content?.subject && fragment.content?.object) {
                        const subject = fragment.content.subject.toLowerCase();
                        const objectVal = fragment.content.object.toLowerCase();
                        if ((keywords.includes(subject) || questionLower.includes(subject)) && answerLower.includes(objectVal)) {
                            supportingScore += fragmentConf;
                            await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { check: 'FactMatch', fragmentId, outcome: 'Support', score: fragmentConf });
                        }
                    }

                    // C) Provenance Checks (Recency Example)
                    if (fragment.provenance?.timestamp_created) {
                        const createdDate = new Date(fragment.provenance.timestamp_created);
                        const ageDays = (Date.now() - createdDate.getTime()) / (1000 * 3600 * 24);
                        if (ageDays > 730) {
                            provenanceIssues++;
                            await addStep(reasoningSteps, requestContext, 'PROVENANCE_CHECK', { check: 'Age', fragmentId, ageDays: Math.round(ageDays), outcome: 'Very Stale (>2yr)' });
                        }
                    }

                    // D) Cross-Chain Attestation Check (Simulated Pass)
                     const attestations = fragment.provenance?.external_attestations;
                      if (attestations && attestations.length > 0) {
                          supportingScore += 0.1 * attestations.length; // Small boost
                          await addStep(reasoningSteps, requestContext, 'CROSSCHAIN_CHECK', { check: 'AttestationExists', fragmentId, count: attestations.length, outcome: 'BoostedConfidence(Simulated)' });
                      }

                } catch (logicError: any) {
                     console.error(`[Verifier Service] Error processing fragment ${fragmentId} for context ${requestContext}: ${logicError.message}`);
                     await addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'LogicExecution', fragmentId, error: logicError.message });
                }
            } // End fragment loop

            usedFragmentCids = fragmentsUsedInLogic; // Update based on actual usage

            // Determine Preliminary Verdict
            confidenceScore = 0.5 + (supportingScore - contradictingScore) * 0.5 - (provenanceIssues * 0.05) - (uncertaintyFlags * 0.2);
            confidenceScore = Math.max(0.01, Math.min(0.99, confidenceScore)); // Clamp

            if (uncertaintyFlags > 0) preliminaryVerdict = 'Flagged: Uncertain';
            else if (contradictingScore > supportingScore * 1.5) preliminaryVerdict = 'Flagged: Contradictory';
            else if (supportingScore > 0.5 && confidenceScore > 0.65) preliminaryVerdict = 'Verified';
            else preliminaryVerdict = 'Unverified';

            await addStep(reasoningSteps, requestContext, 'REASONING_STEP', {
                step: 'LogicComplete',
                calculatedVerdict: preliminaryVerdict,
                calculatedConfidence: confidenceScore,
                supportingScore: supportingScore.toFixed(2),
                contradictoryScore: contradictoryScore.toFixed(2),
                uncertaintyFlags, provenanceIssues
            });
        } // End of else block (if fragments were fetched)


        // --- Step 5: Timelock Commit ---
        // Check if contract address is configured before attempting commit
        if (config.kintaskContractAddress && config.blocklockSenderProxyAddress) {
            await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_ATTEMPT', { verdictToCommit: preliminaryVerdict });
            if (!preliminaryVerdict.startsWith('Error:')) { // Only commit if no prior critical error
                timelockDetails = await commitVerdictTimelocked(preliminaryVerdict, 5, requestContext);
                if (timelockDetails) {
                    await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_SUCCESS', {
                        requestId: timelockDetails.requestId,
                        txHash: timelockDetails.txHash,
                        ciphertextHash: timelockDetails.ciphertextHash,
                        committedVerdict: preliminaryVerdict
                    });
                } else {
                    await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { error: 'commitVerdictTimelocked returned null or failed' });
                    preliminaryVerdict = 'Error: Timelock Failed'; // Update status
                    confidenceScore = 0; // Reset confidence
                }
            } else {
                console.warn(`[Verifier Service] Skipping timelock commit due to prior error status: ${preliminaryVerdict}`);
                await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'Skipped due to prior error', priorStatus: preliminaryVerdict });
            }
        } else {
            console.warn(`[Verifier Service] Skipping timelock commit: KINTASK_CONTRACT_ADDRESS or BLOCKLOCK_SENDER_PROXY_ADDRESS not configured.`);
            await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { reason: 'Skipped: Contract/Proxy address not configured' });
        }


        // --- Step 6: Final Result Object ---
        const finalResult: VerificationResultInternal = {
            finalVerdict: preliminaryVerdict,
            confidenceScore: parseFloat(confidenceScore.toFixed(2)), // Format confidence
            usedFragmentCids: usedFragmentCids,
            reasoningSteps: reasoningSteps, // Return collected steps for controller
            timelockRequestId: timelockDetails?.requestId,
            timelockCommitTxHash: timelockDetails?.txHash,
            ciphertextHash: timelockDetails?.ciphertextHash
        };

        console.log(`[Verifier Service] Verification complete for context ${requestContext}. Verdict: ${finalResult.finalVerdict}, Confidence: ${finalResult.confidenceScore}`);
        return finalResult;

    } catch (error: any) {
        console.error(`[Verifier Service Error Request: ${requestContext}]:`, error.message, error.stack);
        await addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { error: error.message, stage: 'TopLevelCatch' });
        // Return a consistent error state result
         return {
             finalVerdict: 'Error: Verification Failed',
             confidenceScore: 0,
             usedFragmentCids: usedFragmentCids,
             reasoningSteps: reasoningSteps,
             timelockRequestId: timelockDetails?.requestId,
             timelockCommitTxHash: timelockDetails?.txHash,
             ciphertextHash: timelockDetails?.ciphertextHash
         };
    }
}
