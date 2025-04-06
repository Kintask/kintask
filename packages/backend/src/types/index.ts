// types/index.ts

// --- Knowledge Fragment Types ---
// (Keep as is or remove if unused)
export interface KnowledgeFragmentProvenance { /* ... */ }
export interface ExternalAttestation { /* ... */ }
export interface KnowledgeFragment { /* ... */ }


// --- Verification Status (For final aggregated result or synchronous flow) ---
export type VerificationStatus =
    | 'Verified'
    | 'Unverified'
    | 'Flagged: Contradictory'
    | 'Flagged: Uncertain' // <-- Added
    | 'Error: Verification Failed'
    | 'Error: Aggregation Failed'
    | 'Error: Timelock Failed';


// --- Asynchronous Job Statuses (Used in Recall objects) ---
export type JobStatus =
    | 'PendingAnswer'
    | 'PendingVerification'
    | 'VerificationInProgress'
    | 'PendingAggregation'
    | 'AggregationInProgress'
    | 'Completed'
    | 'Error';


// --- Data Structures Stored in Recall ---
export interface QuestionData {
    question: string;
    cid: string; // Knowledge Base CID
    status: JobStatus | 'PendingAnswer';
    timestamp: string; // ISO 8601
    requestContext: string;
    userId?: string;
    paymentRef?: string;
    callbackUrl?: string;
}

export interface AnswerData {
    answer: string;
    answeringAgentId: string;
    status: JobStatus | 'PendingVerification';
    timestamp: string; // ISO 8601
    requestContext: string;
    confidence?: number;
    modelUsed?: string;
}

export interface VerdictData {
    verdict: 'Correct' | 'Incorrect' | 'Uncertain';
    confidence: number;
    explanation?: string;
    verifyingAgentId: string;
    timestamp: string; // ISO 8601
    requestContext: string;
    evidenceSnippets?: { startChar: number; endChar: number }[];
}

// --- API Response for Status Check ---
export interface RequestStatus {
    requestContext: string;
    status: JobStatus | 'Not Found' | 'Error';
    question?: string;
    cid?: string;
    submittedAt: string;
    answer?: string;
    answeredAt?: string;
    answeringAgentId?: string;
    verificationSummary?: {
        correctCount: number;
        incorrectCount: number;
        uncertainCount: number;
        averageConfidence?: number;
    };
    finalVerdict?: VerificationStatus;
    finalVerdictTimestamp?: string;
    error?: string;
}

// --- Recall Logging Event Types (Expanded) ---
export type RecallEventType =
    // Core Flow Events
    | 'QUESTION_LOGGED'
    | 'ANSWER_LOGGED'
    | 'VERDICT_LOGGED'
    | 'ERROR_LOGGED'
    // Agent/Tracing Events
    | 'AGENT_POLL'
    | 'AGENT_JOB_START'
    | 'AGENT_KB_FETCH_START'
    | 'AGENT_KB_FETCH_SUCCESS'
    | 'AGENT_KB_FETCH_FAILURE'
    | 'AGENT_LLM_CALL_START'
    | 'AGENT_LLM_CALL_SUCCESS'
    | 'AGENT_LLM_CALL_FAILURE'
    | 'AGENT_FVM_CALL_START'
    | 'AGENT_FVM_CALL_SUCCESS'
    | 'AGENT_FVM_CALL_FAILURE'
    | 'AGENT_JOB_COMPLETE'
    | 'AGENT_ERROR'
    // Aggregation/Finalization Events
    | 'AGGREGATION_TRIGGERED'
    | 'AGGREGATION_COMPLETE'
    | 'REWARD_DISTRIBUTION_START'
    | 'REWARD_DISTRIBUTION_COMPLETE'
    // Events from older/verifier service flow (ensure all used strings are here)
    | 'VERIFICATION_START'         // <-- Added
    | 'KNOWLEDGE_FETCH_ATTEMPT'    // <-- Added
    | 'KNOWLEDGE_FETCH_SUCCESS'    // <-- Added (Redundant with AGENT_KB_FETCH_SUCCESS? Keep if used)
    | 'TIMELOCK_COMMIT_ATTEMPT'    // <-- Added
    | 'TIMELOCK_COMMIT_SUCCESS'    // <-- Added
    | 'TIMELOCK_COMMIT_FAILURE'    // <-- Added
    | 'TIMELOCK_REVEAL_RECEIVED'   // <-- Added
    | 'VERIFICATION_COMPLETE'      // <-- Added
    | 'REASONING_STEP'             // <-- Added (For local steps array)
    | 'VERIFICATION_ERROR'         // <-- Added (Generic error)
    | 'GENERATOR_MOCK_USED'        // <-- Kept if relevant
    ;


// Recall Log Entry Data (Used for local traces and potentially detailed Recall logs)
export interface RecallLogEntryData {
  timestamp: string; // ISO 8601
  type: RecallEventType;
  details: Record<string, any>;
  requestContext?: string;
  agentId?: string;
  correlationId?: string;
  durationMs?: number;
  errorDetails?: string;
}

// --- Internal Result Structure (Used by synchronous verifyController/verifierService) ---
export interface VerificationResultInternal {
  finalVerdict: VerificationStatus;
  confidenceScore: number;
  usedFragmentCids: string[];
  reasoningSteps: RecallLogEntryData[]; // <-- Added
  timelockRequestId?: string;
  timelockCommitTxHash?: string;
  ciphertextHash?: string;
  aggregationTxHash?: string;
}

// --- API Response for Initial Ask Request ---
export interface ApiAskResponse {
    message: string;
    requestContext: string;
    recallKey: string;
}

// --- API Response for Direct Verification (/verify endpoint) ---
export interface ApiVerifyResponse {
  answer: string; // Generated CLAIM
  status: VerificationStatus; // Final verdict from sync process
  confidence?: number;
  usedFragmentCids?: string[];
  timelockRequestId?: string;
  timelockTxExplorerUrl?: string;
  // Optional: Link to status check or provide trace directly
  statusCheckUrl?: string;
  recallTrace?: RecallLogEntryData[]; // <-- Added
  recallExplorerUrl?: string;
  error?: string; // Error message if processing failed
  details?: string; // More details on the error
  requestContext?: string;
}
// ==== ./types/index.ts ====