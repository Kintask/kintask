// types/index.ts

// --- Knowledge Fragment Types ---
// Basic structures, can be expanded if needed
export interface KnowledgeFragmentProvenance {
    sourceType?: 'research_paper' | 'web_page' | 'user_upload' | 'derived';
    sourceUri?: string;
    retrievalDate?: string; // ISO 8601
    originalAuthor?: string;
    publicationDate?: string;
}
export interface ExternalAttestation {
    attestorId: string;
    claimCid: string;
    verdict: 'Supported' | 'Contradicted' | 'Neutral';
    confidence?: number;
    timestamp: string; // ISO 8601
    signature?: string;
}
export interface KnowledgeFragment {
    cid: string;
    content: string;
    metadata?: { title?: string; keywords?: string[]; chunkIndex?: number; };
    provenance?: KnowledgeFragmentProvenance;
    attestations?: ExternalAttestation[];
    embedding?: number[];
}

// --- LLM Verification Result Structure (Used by generator/verifier/evaluator) ---
// Define and Export this interface
export interface LLMVerificationResult {
    verdict: 'Supported' | 'Contradicted' | 'Neutral'; // For claim verification
    confidence: number; // 0.0 - 1.0
    explanation?: string; // Brief explanation
}

// Define Evaluation-specific result structure
export interface LLMEvaluationResult {
    evaluation: 'Correct' | 'Incorrect' | 'Uncertain'; // For answer evaluation
    confidence: number; // 0.0 - 1.0
    explanation?: string; // Brief explanation
}


// --- Verification Status (Final outcome of evaluation/aggregation) ---
export type VerificationStatus =
    | 'Verified'
    | 'Unverified'
    | 'Flagged: Contradictory'
    | 'Flagged: Uncertain'
    | 'Error: Verification Failed'
    | 'Error: Aggregation Failed'
    | 'Error: Timelock Failed';


// --- Asynchronous Job Statuses (Used in Recall objects & Status API) ---
export type JobStatus =
    | 'PendingAnswer'
    | 'PendingEvaluation'     // Answers submitted, waiting for evaluation
    | 'EvaluationInProgress'  // Evaluation agent is processing this context
    | 'PendingPayout'         // Evaluation complete, results logged, waiting for payout agent
    | 'PayoutInProgress'      // Payout agent is processing this context
    | 'PayoutComplete'        // Payout processing finished (check payout log for details)
    | 'Completed'             // Alternative final state if PayoutComplete isn't used
    | 'NoValidAnswers'        // Evaluation finished, but no answers deemed 'Correct'
    | 'Error';                // Error occurred at some stage (check error logs)


// --- Data Structures Stored in Recall ---

// Stored under: questions/{requestContext}.json
export interface QuestionData {
    question: string;
    cid: string; // Knowledge Base CID
    status: JobStatus; // Tracks the overall status of the request
    timestamp: string; // ISO 8601 submission time
    requestContext: string; // Unique ID for the entire flow
    userId?: string;
    paymentRef?: string;
    callbackUrl?: string;
}

// Stored under: answers/{requestContext}/{agentId}.json
export interface AnswerData {
    answer: string;
    answeringAgentId: string; // e.g., the agent's public key address
    status: 'Submitted'; // Status for this specific answer entry
    timestamp: string; // ISO 8601 answering time
    requestContext: string; // Link back to the question
    confidence?: number; // Optional: Confidence score from answering agent
    modelUsed?: string; // Optional: LLM model used by agent
}

// Stored under: verdicts/{requestContext}/{verifierAgentId}.json (If separate verification step exists)
export interface VerdictData {
    verdict: 'Correct' | 'Incorrect' | 'Uncertain'; // Verifier's opinion
    confidence: number;
    explanation?: string;
    verifyingAgentId: string;
    timestamp: string;
    requestContext: string;
    evidenceSnippets?: { startChar: number; endChar: number }[];
}

// Stored under: evaluation/{requestContext}.json
export interface EvaluationResult {
    evaluatorAgentId: string; // ID of the backend/agent performing the evaluation
    timestamp: string; // ISO 8601 when evaluation was completed & logged
    requestContext: string;
    // Array of evaluations for each answer submitted for this context
    results: Array<{
        answeringAgentId: string; // ID of the agent whose answer was evaluated
        answerKey: string; // Recall key of the specific answer evaluated
        evaluation: 'Correct' | 'Incorrect' | 'Uncertain'; // Judge LLM's verdict
        confidence?: number; // Judge LLM's confidence in its evaluation
        explanation?: string; // Judge LLM's reasoning
    }>;
    // Status reflects the outcome of the evaluation process for this requestContext
    // Added 'PayoutComplete' based on error TS2322
    status: 'PendingPayout' | 'Error' | 'NoValidAnswers' | 'PayoutComplete';
}

// Stored under: payouts/{requestContext}.json
export interface PayoutStatusData {
    payoutAgentId: string; // ID of the backend/agent initiating payout
    payoutTimestamp: string; // ISO 8601 when payout processing was logged
    requestContext: string;
    stage: string; // Last attempted stage (e.g., RegisterAgent_abc, SubmitResult_abc, TriggerAggregation)
    success: boolean; // Overall success of the payout process attempt for this context
    message: string; // Summary message (e.g., "Processed 2 payouts", "Aggregation failed")
    txHashes: Record<string, string>; // Record of relevant transaction hashes
}


// --- API Response for Status Check (`GET /api/status/{requestContext}`) ---
export interface RequestStatus {
    requestContext: string;
    status: JobStatus | 'Not Found' | 'Error'; // Overall derived status
    question?: string;
    cid?: string;
    submittedAt: string;
    hasAnswers?: boolean;
    answerCount?: number;
    evaluationStatus?: EvaluationResult['status']; // Status from the evaluation object
    payoutStatus?: PayoutStatusData['success']; // true/false if processing occurred
    payoutMessage?: string;
    finalVerdict?: VerificationStatus; // If available from contract or final state
    error?: string;
    // Removed 'evaluation' field to avoid returning potentially large nested object
}


// --- Internal Result Structure (Used by synchronous /verify flow) ---
export interface VerificationResultInternal {
  finalVerdict: VerificationStatus;
  confidenceScore: number;
  usedFragmentCids: string[];
  reasoningSteps: RecallLogEntryData[]; // Local trace for sync flow
  timelockRequestId?: string;
  timelockCommitTxHash?: string;
  ciphertextHash?: string;
  aggregationTxHash?: string; // If sync flow interacts with aggregator
}

// --- Recall Logging Event Types ---
// Comprehensive list covering both sync and async flows
export type RecallEventType =
    | 'QUESTION_LOGGED' | 'ANSWER_LOGGED' | 'VERDICT_LOGGED' | 'EVALUATION_LOGGED' | 'PAYOUT_LOGGED' | 'ERROR_LOGGED'
    | 'AGENT_POLL' | 'AGENT_JOB_START' | 'AGENT_KB_FETCH_START' | 'AGENT_KB_FETCH_SUCCESS' | 'AGENT_KB_FETCH_FAILURE'
    | 'AGENT_LLM_CALL_START' | 'AGENT_LLM_CALL_SUCCESS' | 'AGENT_LLM_CALL_FAILURE'
    | 'AGENT_FVM_CALL_START' | 'AGENT_FVM_CALL_SUCCESS' | 'AGENT_FVM_CALL_FAILURE' | 'AGENT_JOB_COMPLETE' | 'AGENT_ERROR'
    | 'AGGREGATION_TRIGGERED' | 'AGGREGATION_COMPLETE' | 'REWARD_DISTRIBUTION_START' | 'REWARD_DISTRIBUTION_COMPLETE'
    | 'VERIFICATION_START' | 'KNOWLEDGE_FETCH_ATTEMPT' | 'KNOWLEDGE_FETCH_SUCCESS'
    | 'TIMELOCK_COMMIT_ATTEMPT' | 'TIMELOCK_COMMIT_SUCCESS' | 'TIMELOCK_COMMIT_FAILURE' | 'TIMELOCK_REVEAL_RECEIVED'
    | 'VERIFICATION_COMPLETE' | 'REASONING_STEP' | 'VERIFICATION_ERROR'
    | 'GENERATOR_MOCK_USED' ;


// Recall Log Entry Data (For detailed tracing if implemented)
export interface RecallLogEntryData {
  timestamp: string; type: RecallEventType; details: Record<string, any>;
  requestContext?: string; agentId?: string; correlationId?: string;
  durationMs?: number; errorDetails?: string;
}

// --- API Responses ---
export interface ApiAskResponse { message: string; requestContext: string; recallKey: string; }
export interface ApiVerifyResponse { // For Sync /verify flow
  answer: string; status: VerificationStatus; confidence?: number; usedFragmentCids?: string[];
  timelockRequestId?: string; timelockTxExplorerUrl?: string; statusCheckUrl?: string;
  recallTrace?: RecallLogEntryData[]; recallExplorerUrl?: string; error?: string;
  details?: string; requestContext?: string;
}

// Declaration for formatGwei helper used in recallService logging
// Note: This is just a type declaration, the implementation is in recallService.ts
declare function formatGwei(value: bigint): string;

// ==== ./src/types/index.ts ====