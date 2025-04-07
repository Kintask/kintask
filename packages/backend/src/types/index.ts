// types/index.ts

// --- Knowledge Fragment Types ---
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

// --- LLM Verification Result Structure ---
export interface LLMVerificationResult {
    verdict: 'Supported' | 'Contradicted' | 'Neutral'; // For claim verification
    confidence: number; // 0.0 - 1.0
    explanation?: string; // Brief explanation
}
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
    | 'PendingEvaluation'
    | 'EvaluationInProgress'
    | 'PendingPayout'
    | 'PayoutInProgress'
    | 'PayoutComplete'
    | 'Completed'
    | 'NoValidAnswers'
    | 'Error';

// --- Data Structures Stored in Recall ---

// questions/{requestContext}.json
export interface QuestionData {
    question: string; cid: string; status: JobStatus; timestamp: string;
    requestContext: string; userId?: string; paymentRef?: string; callbackUrl?: string;
}

// answers/{requestContext}/{agentId}.json
export interface AnswerData {
    answer: string; answeringAgentId: string; status: 'Submitted'; timestamp: string;
    requestContext: string; confidence?: number; modelUsed?: string;
}

// verdicts/{requestContext}/{verifierAgentId}.json (If used)
export interface VerdictData {
    verdict: 'Correct' | 'Incorrect' | 'Uncertain'; confidence: number; explanation?: string;
    verifyingAgentId: string; timestamp: string; requestContext: string;
    evidenceSnippets?: { startChar: number; endChar: number }[];
}

// evaluation/{requestContext}.json
export interface EvaluationResult {
    evaluatorAgentId: string; timestamp: string; requestContext: string;
    results: Array<{
        answeringAgentId: string; answerKey: string;
        evaluation: 'Correct' | 'Incorrect' | 'Uncertain';
        confidence?: number; explanation?: string;
    }>;
    status: 'PendingPayout' | 'Error' | 'NoValidAnswers' | 'PayoutComplete';
}

// payouts/{requestContext}.json
export interface PayoutStatusData {
    payoutAgentId: string; payoutTimestamp: string; requestContext: string;
    stage: string; success: boolean; message: string;
    txHashes: Record<string, string>;
    processedAgents?: number;
    correctAnswers?: number;
    submissionsSent?: number;
    fvmErrors?: number; // <-- ADDED fvmErrors field
}


// --- API Response for Status Check (`GET /api/status/{requestContext}`) ---
export interface RequestStatus {
    requestContext: string; status: JobStatus | 'Not Found' | 'Error';
    question?: string; cid?: string; submittedAt: string;
    hasAnswers?: boolean; answerCount?: number;
    evaluationStatus?: EvaluationResult['status'];
    payoutStatus?: PayoutStatusData['success']; // Use boolean for API
    payoutMessage?: string;
    finalVerdict?: VerificationStatus;
    error?: string;
}


// --- Internal Result Structure (Sync Flow) ---
export interface VerificationResultInternal {
  finalVerdict: VerificationStatus; confidenceScore: number; usedFragmentCids: string[];
  reasoningSteps: RecallLogEntryData[]; timelockRequestId?: string; timelockCommitTxHash?: string;
  ciphertextHash?: string; aggregationTxHash?: string;
}

// --- Recall Logging Event Types ---
export type RecallEventType =
    | 'QUESTION_LOGGED' | 'ANSWER_LOGGED' | 'VERDICT_LOGGED' | 'EVALUATION_LOGGED' | 'PAYOUT_LOGGED' | 'ERROR_LOGGED'
    | 'AGENT_POLL' | 'AGENT_JOB_START' | 'AGENT_KB_FETCH_START' | 'AGENT_KB_FETCH_SUCCESS' | 'AGENT_KB_FETCH_FAILURE'
    | 'AGENT_LLM_CALL_START' | 'AGENT_LLM_CALL_SUCCESS' | 'AGENT_LLM_CALL_FAILURE'
    | 'AGENT_FVM_CALL_START' | 'AGENT_FVM_CALL_SUCCESS' | 'AGENT_FVM_CALL_FAILURE' | 'AGENT_JOB_COMPLETE' | 'AGENT_ERROR'
    | 'AGGREGATION_TRIGGERED' | 'AGGREGATION_COMPLETE' | 'REWARD_DISTRIBUTION_START' | 'REWARD_DISTRIBUTION_COMPLETE'
    // Sync flow events
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
declare function formatGwei(value: bigint): string;

// ==== ./src/types/index.ts ====