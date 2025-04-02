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
import { extractKeywords } from '../utils'; // Use utility for keyword extraction

// --- Helper Function for Logging Steps ---
const addStep = async (
    reasoningSteps: RecallLogEntryData[],
    requestContext: string,
    type: RecallEventType,
    details: Record<string, any>
): Promise<void> => {
    const timestamp = new Date().toISOString();
    // Simple truncation for potentially large values in logs
    const truncatedDetails = Object.entries(details).reduce((acc, [key, value]) => {
        let processedValue = value;
        if (typeof value === 'string' && value.length > 250) { // Increased limit slightly
            processedValue = value.substring(0, 247) + '...';
        } else if (Array.isArray(value) && value.length > 15) { // Increased limit slightly
             processedValue = value.slice(0, 15).concat(['... (truncated)']);
        } else if (typeof value === 'object' && value !== null) {
            // Avoid logging huge objects, maybe just keys or stringify with limit?
            try {
                const strVal = JSON.stringify(value);
                if (strVal.length > 250) {
                     processedValue = `{ keys: [${Object.keys(value).slice(0,5).join(', ')}, ...] (truncated) }`;
                }
            } catch (e) {
                 processedValue = '{ object (serialization error) }';
            }
        }
        acc[key] = processedValue;
        return acc;
    }, {} as Record<string, any>);

    const stepData: RecallLogEntryData = { timestamp, type, details: truncatedDetails, requestContext };
    reasoningSteps.push(stepData);
    // Fire-and-forget logging to Recall for MVP to avoid blocking main flow
    // Add error handling for the async log call itself
    logRecallEvent(type, truncatedDetails, requestContext).catch(err => {
        console.error(`[Verifier Service] Background logging to Recall failed for type ${type}:`, err instanceof Error ? err.message : String(err));
    });
};


// --- Main Verification Logic Function ---
export async function performVerification(
    question: string,
    answer: string,
    requestContext: string // Identifier for this specific verification task
): Promise<VerificationResultInternal> { // Always return a result, even on error

    console.log(`[Verifier Service] Starting verification for context: ${requestContext}`);
    const reasoningSteps: RecallLogEntryData[] = [];
    let usedFragmentCids: string[] = []; // Track CIDs successfully fetched and used in logic
    let preliminaryVerdict: VerificationStatus = 'Unverified'; // Default start
    let confidenceScore = 0.5; // Start neutral
    let timelockDetails: Awaited<ReturnType<typeof commitVerdictTimelocked>> = null;
    let errorOccurred = false;
    let errorMessage = "";

    try {
        // --- Step 1: Input Analysis & Keyword Extraction ---
        const questionLower = question.toLowerCase();
        const answerLower = answer.toLowerCase();
        // Use improved keyword extraction util
        const keywords = extractKeywords(question + " " + answer); // Combine Q&A for keywords
        await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'AnalyzeInput', question: question.substring(0,100), answer: answer.substring(0,100), extractedKeywords: keywords });
        if (keywords.length === 0) {
            console.warn(`[Verifier Service] No suitable keywords extracted from Q: ${question.substring(0,50)} A: ${answer.substring(0,50)}`);
            // Decide whether to proceed or mark as unverified immediately
            preliminaryVerdict = 'Unverified';
            confidenceScore = 0.4; // Lower confidence if no keywords
            await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'KeywordExtraction', outcome: 'No keywords found, marking as Unverified.' });
            // Skip fetching steps if no keywords found
            throw new Error("No keywords extracted, cannot query knowledge base."); // Or proceed with 'Unverified'? Let's throw to show KB wasn't checked.
        }

        // --- Step 2: Fetch Index & Identify Relevant CIDs ---
        await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_ATTEMPT', { stage: 'Index', keywords });
        const index = await getKnowledgeIndex();
        let relevantCids: string[] = [];
        if (index) {
            keywords.forEach(kw => {
                if (index[kw]) {
                    relevantCids.push(...index[kw]);
                }
            });
            relevantCids = [...new Set(relevantCids)]; // Deduplicate CIDs
            await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_SUCCESS', { stage: 'Index', requestedKeywords: keywords, foundCidsCount: relevantCids.length, relevantCids: relevantCids.slice(0, 10) }); // Log some CIDs
            if (relevantCids.length === 0) {
                 console.warn(`[Verifier Service] No relevant fragment CIDs found in index for keywords: ${keywords.join(', ')}`);
                 preliminaryVerdict = 'Unverified';
                 confidenceScore = 0.45; // Slightly higher than no keywords, as index was checked
                 await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'IndexLookup', outcome: 'No fragments found for keywords, marking as Unverified.' });
                 // Skip fragment fetching if no relevant CIDs
                 throw new Error("No relevant CIDs found in index.");
            }
        } else {
            await addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'IndexFetch', error: 'Failed to retrieve knowledge index from Filecoin' });
             throw new Error("Failed to retrieve knowledge index"); // Critical failure
        }


        // --- Step 3: Fetch KG Fragments Concurrently ---
        const MAX_FRAGMENTS_TO_FETCH = 20; // Limit concurrent fetches
        const cidsToFetch = relevantCids.slice(0, MAX_FRAGMENTS_TO_FETCH);
         await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_ATTEMPT', { stage: 'Fragments', totalRelevant: relevantCids.length, fetchingCount: cidsToFetch.length, cidsToFetch: cidsToFetch });
        const fetchPromises = cidsToFetch.map(cid =>
            fetchKnowledgeFragment(cid) // Already includes retry logic
                .then(fragment => ({ cid, fragment })) // Keep track of CID
                .catch(err => {
                    console.error(`[Verifier Service] Unexpected error during fetchKnowledgeFragment for ${cid}:`, err);
                    return { cid, fragment: null }; // Ensure it resolves even on unexpected error
                })
        );
        const fetchedResults = await Promise.all(fetchPromises);

        const fetchedFragments: KnowledgeFragment[] = [];
        const failedFetches: string[] = [];
        fetchedResults.forEach(result => {
            if (result.fragment) {
                // Ensure fragment has CID populated (should be done by filecoinService)
                if (!result.fragment.cid) result.fragment.cid = result.cid;
                fetchedFragments.push(result.fragment);
            } else {
                failedFetches.push(result.cid);
            }
        });
         await addStep(reasoningSteps, requestContext, 'KNOWLEDGE_FETCH_SUCCESS', { stage: 'Fragments', requestedCount: cidsToFetch.length, fetchedCount: fetchedFragments.length, failedCids: failedFetches });
         usedFragmentCids = fetchedFragments.map(f => f.cid || 'unknown_cid'); // Track successfully fetched CIDs considered for logic

        if (fetchedFragments.length === 0) {
             console.warn(`[Verifier Service] No fragments could be successfully fetched for CIDs: ${cidsToFetch.join(', ')}`);
             preliminaryVerdict = 'Unverified'; // Can't verify without fragments
             confidenceScore = 0.4;
             await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'FragmentFetch', outcome: 'No fragments fetched, marking as Unverified.' });
             throw new Error("Failed to fetch any relevant knowledge fragments.");
        }


        // --- Step 4: Apply Verification Logic (Placeholder/Example) ---
         await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { step: 'ApplyVerificationLogicStart', fragmentCount: fetchedFragments.length });
        let supportingEvidenceScore = 0;
        let contradictoryEvidenceScore = 0;
        let uncertaintyFlag = false;
        const processedFragmentIds = new Set<string>(); // Avoid processing duplicates if fetched via multiple keywords

        for (const fragment of fetchedFragments) {
             if (!fragment || !fragment.fragment_id || processedFragmentIds.has(fragment.fragment_id)) {
                continue; // Skip null/invalid or already processed fragments
             }
             processedFragmentIds.add(fragment.fragment_id);
             const fragmentCid = fragment.cid || 'unknown_cid'; // Use CID from fragment if available

            try {
                // A) Provenance Confidence Check
                const provenanceConfidence = fragment.provenance?.confidence_score;
                if (provenanceConfidence !== undefined && provenanceConfidence < 0.5) { // Example threshold for uncertainty
                     uncertaintyFlag = true;
                     await addStep(reasoningSteps, requestContext, 'PROVENANCE_CHECK', { check: 'LowConfidence', fragmentId: fragment.fragment_id, cid: fragmentCid, score: provenanceConfidence });
                     // Maybe don't break, just flag and continue evaluating other evidence?
                     // break; // Stop processing if critical low confidence source encountered?
                }

                // B) Basic Fact Matching / Contradiction (Example)
                 if (fragment.type === 'factual_statement' && fragment.content?.subject && fragment.content?.object) {
                    const subject = String(fragment.content.subject).toLowerCase();
                    const objectVal = String(fragment.content.object).toLowerCase();
                    const baseConfidence = provenanceConfidence ?? 0.7; // Default confidence if missing

                    // Simple Check: Does answer contain the object when question asks about subject?
                    // This logic is very basic and needs significant improvement for real-world use.
                    if (questionLower.includes(subject) && answerLower.includes(objectVal)) {
                        supportingEvidenceScore += baseConfidence * 0.5; // Weight match score by confidence
                        await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { check: 'FactMatch', fragmentId: fragment.fragment_id, cid: fragmentCid, supporting: true, confidence: baseConfidence });
                    } else if (questionLower.includes(subject) && !answerLower.includes(objectVal)) {
                        // Basic Contradiction Check: If Q asks about Subject, KB provides Object, but Answer does *not* contain Object.
                        // This is weak contradiction logic.
                        contradictoryEvidenceScore += baseConfidence * 0.3; // Lower weight for weak contradiction
                         await addStep(reasoningSteps, requestContext, 'REASONING_STEP', { check: 'FactContradictionWeak', fragmentId: fragment.fragment_id, cid: fragmentCid, contradicting: true, confidence: baseConfidence });
                    }
                 }

                // C) Provenance Checks (Example: Recency)
                 if (fragment.provenance?.timestamp_created) {
                     const createdDate = new Date(fragment.provenance.timestamp_created);
                     const ageDays = (Date.now() - createdDate.getTime()) / (1000 * 3600 * 24);
                     if (ageDays > 365 * 2) { // Example: Penalize data older than 2 years
                         supportingEvidenceScore *= 0.8; // Reduce score for stale data
                         await addStep(reasoningSteps, requestContext, 'PROVENANCE_CHECK', { check: 'Age', fragmentId: fragment.fragment_id, cid: fragmentCid, ageDays: Math.round(ageDays), outcome: 'Stale ( > 2 years)' });
                     }
                 }

                 // D) Cross-Chain Attestation Check (Example Simulation)
                  if (fragment.provenance?.external_attestations && fragment.provenance.external_attestations.length > 0) {
                      // Simulate checking an attestation (e.g., EAS on Base Sepolia)
                      // In reality, this might involve an RPC call to the attestation contract
                      const simulatedAttestationCheckPassed = true; // Assume pass for MVP
                      if (simulatedAttestationCheckPassed) {
                          supportingEvidenceScore = Math.min(1.0, supportingEvidenceScore + 0.1); // Small confidence boost
                           await addStep(reasoningSteps, requestContext, 'CROSSCHAIN_CHECK', { check: 'AttestationSimulated', fragmentId: fragment.fragment_id, cid: fragmentCid, outcome: 'Verified (Simulated)', attestations: fragment.provenance.external_attestations });
                      }
                  }

            } catch (logicError: any) {
                 console.error(`[Verifier Service] Error processing fragment ${fragment.fragment_id} (CID: ${fragmentCid}): ${logicError.message}`);
                 await addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { stage: 'LogicExecution', fragmentId: fragment.fragment_id, cid: fragmentCid, error: logicError.message });
                 // Continue processing other fragments even if one fails
            }
        } // End fragment loop

        // Determine Preliminary Verdict based on aggregated scores/flags
        // This scoring logic is rudimentary and needs refinement.
        if (uncertaintyFlag) {
            preliminaryVerdict = 'Flagged: Uncertain';
            confidenceScore = 0.3; // Low confidence if uncertain flag hit
        } else if (contradictoryEvidenceScore > supportingEvidenceScore + 0.1) { // Require contradiction to significantly outweigh support
             preliminaryVerdict = 'Flagged: Contradictory';
             confidenceScore = Math.max(0.1, 0.5 - (contradictoryEvidenceScore - supportingEvidenceScore));
        } else if (supportingEvidenceScore > 0.1) { // Require some minimal supporting evidence
            preliminaryVerdict = 'Verified';
            // Confidence based on supporting evidence, capped below 1.0
            confidenceScore = Math.min(0.98, 0.5 + supportingEvidenceScore * 0.6);
        } else {
            preliminaryVerdict = 'Unverified'; // Default if insufficient evidence or only weak contradictions
            confidenceScore = 0.4; // Slightly below neutral
        }

        await addStep(reasoningSteps, requestContext, 'REASONING_STEP', {
            step: 'LogicComplete',
            calculatedVerdict: preliminaryVerdict,
            calculatedConfidence: Number(confidenceScore.toFixed(3)),
            supportingScore: Number(supportingEvidenceScore.toFixed(3)),
            contradictoryScore: Number(contradictoryEvidenceScore.toFixed(3)),
            uncertaintyFlag: uncertaintyFlag
        });


        // --- Step 5: Timelock Commit ---
        const verdictToCommit = `${preliminaryVerdict} (Conf: ${confidenceScore.toFixed(2)})`; // Commit status + confidence
        await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_ATTEMPT', { verdictToCommit });
        // Only commit if verification didn't critically fail before this point
        timelockDetails = await commitVerdictTimelocked(verdictToCommit, 5, requestContext); // Pass context for logging
        if (timelockDetails) {
            await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_SUCCESS', {
                requestId: timelockDetails.requestId,
                txHash: timelockDetails.txHash,
                ciphertextHash: timelockDetails.ciphertextHash,
                committedVerdict: verdictToCommit // Log what was actually committed
            });
        } else {
            await addStep(reasoningSteps, requestContext, 'TIMELOCK_COMMIT_FAILURE', { error: 'commitVerdictTimelocked returned null or failed' });
            // Update status to reflect commit failure, but keep previous calculated scores/verdict for context
            preliminaryVerdict = 'Error: Timelock Failed'; // Final status reflects the failure point
            confidenceScore = 0; // Confidence drops to 0 on critical failure
            errorOccurred = true; // Mark error
            errorMessage = "Failed to commit verdict via timelock.";
        }

    } catch (error: any) {
        console.error(`[Verifier Service Error Request: ${requestContext}]:`, error.message, error.stack);
        // Ensure error is logged if it happens outside the addStep calls or before timelock
        await addStep(reasoningSteps, requestContext, 'VERIFICATION_ERROR', { error: error.message, stage: 'MainTryCatch' });
        preliminaryVerdict = 'Error: Verification Failed'; // Set error status
        confidenceScore = 0;
        errorOccurred = true;
        errorMessage = error.message;
    }

    // --- Step 6: Final Result Object ---
    // Ensure confidence is within [0, 1] bounds
    confidenceScore = Math.max(0, Math.min(1, confidenceScore));

    const finalResult: VerificationResultInternal = {
        finalVerdict: preliminaryVerdict, // Reflects final status, including errors
        confidenceScore: Number(confidenceScore.toFixed(3)),
        usedFragmentCids: usedFragmentCids, // CIDs that were successfully fetched and considered
        reasoningSteps: reasoningSteps,
        timelockRequestId: timelockDetails?.requestId,
        timelockCommitTxHash: timelockDetails?.txHash,
        ciphertextHash: timelockDetails?.ciphertextHash
    };

    if (errorOccurred) {
         console.error(`[Verifier Service] Verification failed for context ${requestContext}. Final Status: ${finalResult.finalVerdict}. Error: ${errorMessage}`);
    } else {
         console.log(`[Verifier Service] Verification complete for context ${requestContext}. Final Verdict: ${finalResult.finalVerdict}, Confidence: ${finalResult.confidenceScore}`);
    }

    return finalResult; // Always return the result object
}
