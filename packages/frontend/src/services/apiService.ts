import axios, { AxiosError } from 'axios';
import {
    AskApiResponse,
    ApiErrorResponse,
    ApiVerifyResponse, // Main structure for final results
    VerificationStatus,
    RecallLogEntryData // Structure for trace logs
} from '@/types';

// --- Configuration ---
const USE_MOCK_API = false; // Set true for mock data
const MOCK_API_DELAY = 750; // Delay for /ask submission
const MOCK_STATUS_DELAY = 1500; // Delay for /status check
// --- End Configuration ---

const API_BASE_URL = '/api'; // For real API calls

// --- Mock Data Generation Helpers ---

function createMockAskSuccessResponse(question: string, kbCid: string): AskApiResponse {
    const timestamp = Date.now();
    const contextId = `mock_ctx_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
    const recallKey = `mock_recall_${timestamp}`;
    console.log(`[Mock API - askQuestion] Generating SUCCESS response for context: ${contextId}`);
    return {
        message: `Mock request for "${question.substring(0,20)}..." received successfully.`,
        requestContext: contextId,
        recallKey: recallKey,
    };
}

function createMockAskErrorResponse(reason: string = "Mock processing error"): ApiErrorResponse {
     console.log(`[Mock API - askQuestion] Generating ERROR response: ${reason}`);
    return { isError: true, error: `Mock Submission Failed: ${reason}`, details: `Simulated error from mock askQuestion.` };
}

function createMockStatusErrorResponse(requestContext: string, reason: string = "Mock status check failed"): ApiErrorResponse {
    console.log(`[Mock API - getStatus] Generating ERROR response for ${requestContext}: ${reason}`);
    return { isError: true, error: `Mock Status Failed: ${reason}`, details: `Simulated error for ${requestContext}.` };
}

// Creates a mock *final* ApiVerifyResponse, simulating the result *after* agent and evaluation.
function createMockFinalResult(requestContext: string, originalQuestion?: string): ApiVerifyResponse {
    console.log(`[Mock API - getStatus] Simulating final SUCCESS result for ${requestContext}`);
    const randomStatus: VerificationStatus[] = ['Verified', 'Flagged: Uncertain', 'Flagged: Contradictory'];
    const selectedStatus = randomStatus[Math.floor(Math.random() * randomStatus.length)];
    const confidence = selectedStatus === 'Verified' ? Math.random() * 0.3 + 0.7 : Math.random() * 0.5 + 0.2;
    const shortContext = requestContext.substring(requestContext.length - 6);
    const agentId = `0xMockAgent${shortContext}`; // Simulate an agent ID

    // Simulate a plausible answer based on a generic understanding of the question
    let simulatedAnswer = `Regarding your query about "${originalQuestion ? originalQuestion.substring(0, 30) + '...' : 'your request'}", the mock analysis suggests the following: based on simulated consensus from multiple agents (including ${agentId.substring(0,12)}...), the information aligns reasonably well with the simulated knowledge base fragments.`;
    if (selectedStatus === 'Flagged: Uncertain') {
        simulatedAnswer += " However, some minor inconsistencies were detected, leading to an 'Uncertain' flag. Further review might be needed.";
    } else if (selectedStatus === 'Flagged: Contradictory') {
        simulatedAnswer += " Significant contradictions were found between different simulated sources or agents, resulting in a 'Contradictory' flag. The provided information should be treated with caution.";
    } else { // Verified
        simulatedAnswer += " The consensus indicates the information is consistent and verified against the mock sources.";
    }

    // Simulate a trace representing backend processes *after* the agent logs its answer
    const mockTrace: RecallLogEntryData[] = [
        // Agent might log this (simulated for context)
        { timestamp: new Date(Date.now() - 2000).toISOString(), type: 'AGENT_ANSWER_LOGGED', details: { agentId: agentId, answerSnippet: simulatedAnswer.substring(0, 50)+'...' }, requestContext },
        // Backend evaluation/consensus steps
        { timestamp: new Date(Date.now() - 1000).toISOString(), type: 'EVALUATION_START', details: { requestContext: requestContext, agentsToEvaluate: [agentId, '0xOtherAgent...'] }, requestContext },
        { timestamp: new Date(Date.now() - 500).toISOString(), type: 'EVALUATION_CONSENSUS_CALCULATED', details: { consensusStatus: selectedStatus, confidence: parseFloat(confidence.toFixed(2)) }, requestContext },
        // Optional timelock step simulation
        ...(selectedStatus === 'Verified' ? [{ timestamp: new Date().toISOString(), type: 'TIMELOCK_INITIATED' as any, details: { requestId: `mock_tl_${shortContext}` }, requestContext }] : []),
    ];
     if (selectedStatus.startsWith('Flagged')) {
         mockTrace.push({ timestamp: new Date(Date.now() - 100).toISOString(), type: 'FINAL_STATUS_ 결정', details: { reason: `Consensus flagging due to ${selectedStatus.split(': ')[1].toLowerCase()} results.` }, requestContext });
     }

    return {
        answer: simulatedAnswer,
        status: selectedStatus,
        confidence: parseFloat(confidence.toFixed(2)),
        usedFragmentCids: [`bafk...mockFrag1${shortContext}`, `bafk...mockFrag2${shortContext}`], // CIDs used by the overall process
        timelockRequestId: selectedStatus === 'Verified' ? `mock_tl_${shortContext}` : undefined,
        timelockTxExplorerUrl: selectedStatus === 'Verified' ? `https://mock-explorer.xyz/tx/0x${shortContext}abc...` : undefined,
        recallTrace: mockTrace, // The simulated backend trace
        recallExplorerUrl: `https://mock-recall-explorer.xyz/request/${requestContext}`,
        error: undefined,
        details: `Mock final result generated at ${new Date().toLocaleTimeString()}`,
    };
}

// Simulates a final error status response from the backend's perspective
function createMockFinalErrorResult(requestContext: string): ApiVerifyResponse {
     console.log(`[Mock API - getStatus] Simulating final ERROR result for ${requestContext}`);
     const shortContext = requestContext.substring(requestContext.length - 6);
     const agentId = `0xMockAgent${shortContext}`;
     // Simulate trace showing an error during backend processing (e.g., evaluation)
      const mockTrace: RecallLogEntryData[] = [
        { timestamp: new Date(Date.now() - 1000).toISOString(), type: 'AGENT_ANSWER_LOGGED', details: { agentId: agentId }, requestContext },
        { timestamp: new Date().toISOString(), type: 'ERROR_EVALUATION', details: { reason: "Consensus calculation failed due to insufficient valid agent responses." }, requestContext },
     ];
     return {
         answer: "Verification could not be completed due to an internal processing error.",
         status: 'Error: Verification Failed',
         confidence: 0.05,
         usedFragmentCids: [],
         recallTrace: mockTrace, // Include trace showing the error point
         error: "Evaluation process failed",
         details: `Simulated backend evaluation failure for request ...${shortContext}`,
     };
}


// --- API Service Functions ---

/**
 * Submits a question and knowledge base CID. (Mockable)
 */
export async function askQuestion(question: string, knowledgeBaseCid: string): Promise<AskApiResponse | ApiErrorResponse> {
  const trimmedQuestion = question.trim();
  const trimmedKnowledgeBaseCid = knowledgeBaseCid.trim();

  // --- MOCK API LOGIC ---
  if (USE_MOCK_API) {
    console.log(`[Mock API - askQuestion] Received: Question="${trimmedQuestion.substring(0, 50)}...", KB CID="${trimmedKnowledgeBaseCid}"`);
    if (!trimmedQuestion) { return createMockAskErrorResponse("Question cannot be empty."); }
    if (!trimmedKnowledgeBaseCid || !(trimmedKnowledgeBaseCid.startsWith('Qm') || trimmedKnowledgeBaseCid.startsWith('bafy') || trimmedKnowledgeBaseCid.startsWith('bafk'))) { return createMockAskErrorResponse("Invalid/missing KB CID format."); }
    await new Promise(resolve => setTimeout(resolve, MOCK_API_DELAY));
    return createMockAskSuccessResponse(trimmedQuestion, trimmedKnowledgeBaseCid);
  }

  // --- REAL API LOGIC ---
  // ... (Keep actual Axios logic as before) ...
  console.log(`[API Service - askQuestion] Submitting REAL request...`);
  if (!trimmedQuestion) { return { isError: true, error: "Question cannot be empty." }; }
  if (!trimmedKnowledgeBaseCid || !(trimmedKnowledgeBaseCid.startsWith('Qm') || trimmedKnowledgeBaseCid.startsWith('bafy') || trimmedKnowledgeBaseCid.startsWith('bafk'))) { return { isError: true, error: "Invalid/missing KB CID format." }; }
  const requestBody = { question: trimmedQuestion, knowledgeBaseCid: trimmedKnowledgeBaseCid };
  try {
    const response = await axios.post<AskApiResponse>(`${API_BASE_URL}/ask`, requestBody, { timeout: 30000, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
    if (!response.data || typeof response.data.message !== 'string' || typeof response.data.requestContext !== 'string' || typeof response.data.recallKey !== 'string') { return { isError: true, error: "Unexpected server response structure.", details: JSON.stringify(response.data) }; }
    return response.data;
  } catch (error: any) {
    let errorMessage = 'Unknown submission error.'; let errorDetails: string | undefined;
    if (axios.isAxiosError(error)) { const axiosError = error as AxiosError<any>; if (axiosError.code === 'ECONNABORTED' || axiosError.message.toLowerCase().includes('timeout')) { errorMessage = "Submission timed out."; errorDetails = `Timeout: ${axiosError.config?.timeout}ms.`; } else if (axiosError.response) { const statusCode = axiosError.response.status; const responseData = axiosError.response.data; console.error(`[API Service - askQuestion] Server error: ${statusCode}`, responseData); errorMessage = `Server error during submission (${statusCode}).`; const backendErrorMsg = (typeof responseData === 'object' && responseData !== null) ? responseData.error || responseData.message || responseData.detail : (typeof responseData === 'string' ? responseData : null); if (typeof backendErrorMsg === 'string' && backendErrorMsg.trim() !== '') { errorMessage = backendErrorMsg; } errorDetails = `Status: ${statusCode}. Response: ${typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData).substring(0, 200)}`; } else if (axiosError.request) { errorMessage = "Network Error: No response."; errorDetails = `Is backend running?`; } else { errorMessage = `Request setup error: ${axiosError.message}`; } } else { errorMessage = `Unexpected error: ${error.message || String(error)}`; }
    return { isError: true, error: errorMessage, details: errorDetails };
  }
}


/**
 * Fetches the status/result for a given request context ID. (Mockable)
 * Simulates receiving the final ApiVerifyResponse from the backend status endpoint.
 *
 * @param requestContext The unique ID of the request to check.
 * @param originalQueryInfo Optional info about the original query (needed for mock answer generation)
 */
export async function getVerificationResult(
    requestContext: string,
    originalQueryInfo?: { question: string; kbCid?: string } // Pass original question for better mock answer
): Promise<ApiVerifyResponse | ApiErrorResponse> {
      // --- MOCK API LOGIC ---
      if (USE_MOCK_API) {
        console.log(`[Mock API - getStatus] Requesting status for: ${requestContext}`);
        await new Promise(resolve => setTimeout(resolve, MOCK_STATUS_DELAY));

        // Simulate based on context ID or randomness
        if (requestContext.includes("fail_status")) {
             return createMockStatusErrorResponse(requestContext, "Simulated network error during status check");
        }

        // Simulate still processing ~33%
        const processingChance = Math.random();
        if (processingChance < 0.33) {
            console.log(`[Mock API - getStatus] Simulating 'Processing' for ${requestContext}`);
             return {
                 answer: "", // Empty answer while processing
                 status: 'Processing',
             } as ApiVerifyResponse; // Intermediate state
        }

        // Simulate final internal error ~10%
        if (processingChance < 0.43) { // 0.33 + 0.10
             return createMockFinalErrorResult(requestContext);
        }

        // Default to final success, passing original question if available
        return createMockFinalResult(requestContext, originalQueryInfo?.question);
      }

      // --- REAL API LOGIC (Placeholder) ---
      console.warn(`[API Service - getStatus] Real status check for ${requestContext} not fully implemented.`);
       try {
           const response = await axios.get<ApiVerifyResponse>(`${API_BASE_URL}/status/${requestContext}`, { timeout: 10000, headers: { 'Accept': 'application/json' } });
            if (response.data && typeof response.data.answer === 'string' && typeof response.data.status === 'string') { return response.data; }
            else { return { isError: true, error: "Invalid status response structure", details: JSON.stringify(response.data)}; }
       } catch (error: any) {
            let errorMessage = 'Unknown error fetching status.'; let errorDetails: string | undefined;
             if (axios.isAxiosError(error)) { const axiosError = error as AxiosError<any>; if (axiosError.code === 'ECONNABORTED' || axiosError.message.toLowerCase().includes('timeout')) { errorMessage = "Status check timed out."; } else if (axiosError.response) { const statusCode = axiosError.response.status; const responseData = axiosError.response.data; errorMessage = `Server error (${statusCode}) fetching status.`; const backendErrorMsg = (typeof responseData === 'object' && responseData !== null) ? responseData.error || responseData.message || responseData.detail : (typeof responseData === 'string' ? responseData : null); if (typeof backendErrorMsg === 'string' && backendErrorMsg.trim() !== '') { errorMessage = backendErrorMsg; } errorDetails = `Status: ${statusCode}. Response: ${typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData).substring(0, 200)}`; } else if (axiosError.request) { errorMessage = "Network Error: No response for status check."; } else { errorMessage = `Request setup error: ${axiosError.message}`; } } else { errorMessage = `Unexpected error: ${error.message || String(error)}`; }
             return { isError: true, error: errorMessage, details: errorDetails };
       }
}

// /src/services/apiService.ts