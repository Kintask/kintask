// --- Knowledge Fragment Structure (Stored on Filecoin) ---
export interface KnowledgeFragmentProvenance {
  source_type: string; // e.g., 'dataset_snapshot', 'web_scrape', 'human_curated', 'api_call'
  source_name?: string;
  source_cid?: string; // CID of larger dataset if applicable
  source_url?: string; // URL if scraped
  curation_method?: string;
  curator_id?: string; // e.g., DID
  timestamp_created: string; // ISO 8601
  confidence_score?: number; // 0.0 to 1.0
  external_attestations?: ExternalAttestation[];
}

export interface ExternalAttestation {
    chain: string; // e.g., 'Optimism', 'BaseSepolia'
    type: string; // e.g., 'EAS', 'Verax'
    schema_uid?: string;
    attestation_uid?: string; // Linkable UID on the attestation network
    attestation_data?: Record<string, any>; // Parsed data if relevant
}

export interface KnowledgeFragment {
  fragment_id: string; // Unique identifier for this version
  type: string; // e.g., 'factual_statement', 'rule', 'definition'
  keywords?: string[]; // For indexing
  content: Record<string, any>; // The actual data/fact/rule
  provenance: KnowledgeFragmentProvenance;
  version: number;
  previous_version_cid?: string | null;
}

// --- Verification & Recall ---
export type VerificationStatus =
    | 'Verified'
    | 'Unverified'
    | 'Flagged: Uncertain'
    | 'Flagged: Contradictory'
    | 'Error: Verification Failed'
    | 'Error: Timelock Failed';

// Result returned internally by the Verifier Service
export interface VerificationResultInternal {
  finalVerdict: VerificationStatus;
  confidenceScore: number; // Overall confidence
  usedFragmentCids: string[]; // List of Filecoin CIDs actually used
  reasoningSteps: RecallLogEntryData[]; // Detailed steps taken
  timelockRequestId?: string; // Blocklock on-chain request ID
  timelockCommitTxHash?: string; // L2 Tx hash for the commit
  ciphertextHash?: string; // Hash of the committed ciphertext
}

// --- Recall Logging ---
export type RecallEventType =
    | 'VERIFICATION_START'
    | 'KNOWLEDGE_FETCH_ATTEMPT'
    | 'KNOWLEDGE_FETCH_SUCCESS' // Log CIDs fetched
    | 'TIMELOCK_COMMIT_ATTEMPT'
    | 'TIMELOCK_COMMIT_SUCCESS' // Log Request ID, Ciphertext Hash, Tx Hash
    | 'TIMELOCK_COMMIT_FAILURE'
    | 'REASONING_STEP' // Log rule/fact applied, CID used, outcome
    | 'PROVENANCE_CHECK' // Log check on provenance data
    | 'CROSSCHAIN_CHECK' // Log check on external attestation
    | 'FINAL_VERDICT_CALCULATED' // Log verdict before reveal check
    | 'TIMELOCK_REVEAL_RECEIVED' // Log revealed verdict, check match
    | 'VERIFICATION_COMPLETE'
    | 'VERIFICATION_ERROR'
    | 'GENERATOR_MOCK_USED'; // Added for mock logging

// Structure for data field in Recall log entries
export interface RecallLogEntryData {
  timestamp: string;
  type: RecallEventType;
  details: Record<string, any>; // Context-specific details for each event type
  requestContext?: string; // Identifier for the overall Q&A request
}

// --- API Response Structure (Controller to Frontend) ---
export interface ApiVerifyResponse {
  answer: string;
  status: VerificationStatus;
  confidence?: number;
  usedFragmentCids?: string[];
  timelockRequestId?: string;
  timelockTxExplorerUrl?: string; // Link to L2 explorer for commit Tx
  recallTrace?: RecallLogEntryData[]; // Snippets or full trace for this request
  recallExplorerUrl?: string; // Link to Recall explorer if available
  error?: string; // Optional error message for frontend display
  details?: string; // Optional error details
}
