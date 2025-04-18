// Types shared between Frontend and potentially Backend (if not using monorepo linking)

// --- Verification Status (Matches Backend - For FINAL Result) ---
export type VerificationStatus =
  | 'Verified'
  | 'Unverified' // Often an initial or intermediate state
  | 'Flagged: Uncertain'
  | 'Flagged: Contradictory'
  | 'Error: Verification Failed'
  | 'Error: Timelock Failed'
  // Add states relevant during processing if needed by the /status endpoint
  | 'Processing'
  | 'Pending Verification'
  | 'Completed' // Generic completion before specific status?
  // Add frontend-specific error statuses if needed
  | 'Error: Network/Server Issue'
  | 'Error: Invalid Response Format'
  | 'Error: Request Setup Failed'
  | 'Error: Unknown Client Issue'
  | 'Error: No Response'
  | 'System Notification'; // For system messages in chat

// --- Recall Log Entry (Matches Backend - For FINAL Result) ---
export interface RecallLogEntryData {
  timestamp: string;
  type: string; // e.g., 'START', 'LLM_QUERY', 'RECALL_FETCH', 'VERDICT', 'ERROR'
  details: Record<string, any>; // Flexible details object
  requestContext?: string; // Link back to the overall request
}


export interface EvaluationResult {
  requestContext: string;
  results: Array<{ // Changed to Array<> syntax for consistency
      answeringAgentId: string;
      answerKey: string; // Key where AnswerData is stored (e.g., reqs/.../answers/{agentId}.json)
      evaluation: 'Correct' | 'Incorrect' | 'Uncertain' | 'Error'; // LLM eval result + potential error state
      confidence: number; // LLM confidence
      explanation: string; // LLM explanation
      fulfillmentUID: string | null; // UID of the AnswerStatement attestation <<< Keep name
      validationUID?: string | null; // UID of the ZKPValidator attestation <<< ADDED
  }>;
  // Status reflects the outcome of the evaluation process *before* payout attempt
  status: 'PendingPayout' | 'NoValidAnswers' | 'Error' | 'PayoutComplete'; // Added PayoutComplete here too
  evaluatorAgentId: string; // ID of the backend evaluator service
  timestamp: string; // ISO 8601 when evaluation was completed
  answerCount?: number; // Optional: total answers received
  correctCount?: number; // Optional: count deemed 'Correct' by LLM
}

// --- FINAL API Response Structure (Expected from e.g., /api/status/{contextId}) ---
export interface ApiVerifyResponse {
  answer: string;                    // The final generated answer
  status: VerificationStatus;        // The final verification outcome
  confidence?: number;               // 0.0 to 1.0, optional confidence score
  usedFragmentCids?: string[];       // List of Filecoin CIDs used from Recall
  timelockRequestId?: string;        // ID related to timelock mechanism (if used)
  timelockTxExplorerUrl?: string;    // Direct link to L2 explorer for timelock tx
  recallTrace?: RecallLogEntryData[];// Array of log entries from the process
  recallExplorerUrl?: string;        // Link to Recall explorer (if applicable)
  error?: string;                    // High-level error message if status indicates failure
  details?: string;                  // More detailed error/process info (optional)
}

// In packages/frontend/src/types/index.ts

// --- Question Data Structure (for fetching user questions) ---
export interface QuestionData {
  question: string;
  cid: string; // CID of the knowledge base fragment used
  status: VerificationStatus; // Reusing the VerificationStatus type
  timestamp: string; // ISO 8601 when the question was submitted
  requestContext: string; // Unique ID for the entire request flow
  paymentUID?: string; // UID of the ERC20PaymentStatement attestation
  paymentRef?: string; // Optional reference string related to payment
  callbackUrl?: string; // Optional URL to notify upon completion/error
  user?: string // User's Ethereum address
}
// --- INITIAL API Response Structure (Expected from /api/ask) ---
export interface AskApiResponse {
  message: string;        // Confirmation message (e.g., "Request received...")
  requestContext: string; // Unique ID to track this specific request
  recallKey: string;      // Key related to the recall operation (if applicable)
}

// --- API Error Structure (For Frontend Service Functions) ---
/**
 * Structure for handling errors returned specifically from frontend API service calls.
 */
export interface ApiErrorResponse {
  error: string;          // User-facing or internal error message
  details?: string;       // Optional technical details (like status code, raw data snippet)
  isError: true;          // Type guard flag
}


// --- Frontend-Specific Types ---

// It should contain fields from both AnswerData and EvaluationData
export interface FinalVerificationResult {
  requestContext: string;
  question: string;
  kbCid: string; // Although not in the example JSON, App.tsx adds it
  answer?: string;             // From AnswerData
  evaluation?: string;         // From EvaluationResult -> evaluation field
  confidence?: number;         // From EvaluationResult -> confidence field
  explanation?: string;        // From EvaluationResult -> explanation field
  status: VerificationStatus | string; // Final overall status from EvaluationData or polling logic
  answerTimestamp?: string;    // From AnswerData
  evaluationTimestamp?: string;// From EvaluationData
  answeringAgentId?: string;   // From AnswerData or EvaluationResult
  evaluatorAgentId?: string;   // From EvaluationData
  // Ensure recallTrace is part of this object if App.tsx includes it
  recallTrace?: RecallLogEntryData[];
  error?: string;              // If polling or backend indicates an error state
  // Add fields seen in the /evaluation-data example JSON if needed
  fulfillmentUID?: string;     // Present in both Answer and Eval example
  validationUID?: string;      // Present in both Answer and Eval example
  // Add fields seen in the /answers example JSON if needed
  // (status from answer is less relevant than final eval status)
}

// ChatMessage should store this structure in its apiResponse field
export interface ChatMessage {
  id: number;
  sender: 'User' | 'AI' | 'System';
  text: string; // Will hold the final 'answer' field for AI messages
  isLoading?: boolean;
  // Store the *final* combined result object
  verificationResult?: Partial<FinalVerificationResult> | null; // Use Partial if built incrementally
  requestContext?: string;
}

/**
 * Represents an entry in the user's locally stored history.
 * Tracks the query and eventually links to the final result message.
 */
export interface HistoryEntry {
  questionText: string;             // The original user question
  knowledgeBaseCid?: string;       // The KB CID used for this query (if any)
  requestContext: string;           // The unique ID received from /api/ask
  // aiMessage will be populated *after* the final result is fetched successfully
  aiMessage?: ChatMessage;          // Stores the final ChatMessage containing the ApiVerifyResponse
}

export interface AnswerData {
  answer: string; // The actual answer text generated by the agent
  answeringAgentId: Address; // Ethereum address of the agent
  status: 'Submitted'; // Simple status for the answer itself
  timestamp: string; // ISO 8601 when the answer was submitted
  requestContext: string; // Links back to the original question
  confidence?: number; // Agent's self-reported confidence (optional)
  modelUsed?: string; // LLM model used by the agent (optional)
  fulfillmentUID: string | null; // UID of the *AnswerStatement* attestation <<< Keep original name but clarify meaning
  validationUID?: string | null; // UID of the *ZKPValidator* attestation <<< ADDED
}
// /src/types.ts