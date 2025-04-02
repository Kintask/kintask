// Types shared between Frontend and potentially Backend (if not using monorepo linking)

// --- Verification Status (Matches Backend) ---
export type VerificationStatus =
    | 'Verified'
    | 'Unverified'
    | 'Flagged: Uncertain'
    | 'Flagged: Contradictory'
    | 'Error: Verification Failed'
    | 'Error: Timelock Failed';

// --- Recall Log Entry (Matches Backend) ---
 export interface RecallLogEntryData {
  timestamp: string;
  type: string; // Use string for flexibility, could map to enum/const later
  details: Record<string, any>;
  requestContext?: string;
}

// --- API Response Structure (Expected from Backend) ---
export interface ApiVerifyResponse {
  answer: string;
  status: VerificationStatus; // Use defined type
  confidence?: number; // 0.0 to 1.0
  usedFragmentCids?: string[]; // List of Filecoin CIDs
  timelockRequestId?: string;
  timelockTxExplorerUrl?: string; // Direct link to L2 explorer
  recallTrace?: RecallLogEntryData[]; // Array of log entries
  recallExplorerUrl?: string; // Link to Recall explorer (if applicable)
  error?: string; // High-level error message for UI
  details?: string; // More detailed error info (optional)
}

// --- Frontend-Specific Types ---

// Structure for messages displayed in the chat UI
export interface ChatMessage {
    id: number; // Unique ID for React key prop
    sender: 'User' | 'AI';
    text: string; // The main message content
    isLoading?: boolean; // True if AI message is waiting for response
    // Store the full API response within the AI message for easy access in MessageDisplay
    apiResponse?: ApiVerifyResponse;
}
