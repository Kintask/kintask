// types/index.ts

// Keep KnowledgeFragment interfaces if needed for future complex KBs
export interface KnowledgeFragmentProvenance { /* ... */ }
export interface ExternalAttestation { /* ... */ }
export interface KnowledgeFragment { /* ... */ }

// VerificationStatus remains the same
export type VerificationStatus = | 'Verified' | 'Unverified' | 'Flagged: Uncertain' | 'Flagged: Contradictory' | 'Error: Verification Failed' | 'Error: Timelock Failed';

// Internal result structure
export interface VerificationResultInternal {
  finalVerdict: VerificationStatus; // The aggregated verdict
  confidenceScore: number; // Aggregated confidence
  usedFragmentCids: string[]; // CIDs supporting the consensus verdict
  reasoningSteps: RecallLogEntryData[]; // Detailed local log
  timelockRequestId?: string;
  timelockCommitTxHash?: string;
  ciphertextHash?: string;
}

// Recall Logging Events
export type RecallEventType =
    | 'VERIFICATION_START'
    | 'KNOWLEDGE_FETCH_ATTEMPT'
    | 'KNOWLEDGE_FETCH_SUCCESS'
    | 'VERIFIER_SUBMISSION'         // Individual agent result log (mocked)
    | 'SIMULATED_REWARD_ATTEMPT'
    | 'SIMULATED_REWARD_SUBMITTER'
    | 'SIMULATED_REWARD_AGENT'
    | 'SIMULATED_REWARD_SKIPPED'
    | 'TIMELOCK_COMMIT_ATTEMPT'
    | 'TIMELOCK_COMMIT_SUCCESS'
    | 'TIMELOCK_COMMIT_FAILURE'
    | 'REASONING_STEP'              // Primarily for local steps array
    | 'FINAL_VERDICT_CALCULATED'    // Log the aggregated result (mocked)
    | 'TIMELOCK_REVEAL_RECEIVED'
    | 'VERIFICATION_COMPLETE'       // Final batch log type
    | 'VERIFICATION_ERROR'          // Log significant errors / final error batch
    | 'GENERATOR_MOCK_USED';        // Keep for generator calls

// Recall Log Entry Data
export interface RecallLogEntryData {
  timestamp: string;
  type: RecallEventType;
  details: Record<string, any>;
  requestContext?: string;
}

// API Response Structure
export interface ApiVerifyResponse {
  answer: string; // Generated CLAIM
  status: VerificationStatus; // AGGREGATED status
  confidence?: number;
  usedFragmentCids?: string[];
  timelockRequestId?: string;
  timelockTxExplorerUrl?: string;
  recallTrace?: RecallLogEntryData[]; // The locally collected trace array
  recallExplorerUrl?: string;
  error?: string;
  details?: string;
}