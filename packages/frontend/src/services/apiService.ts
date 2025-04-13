// /src/services/apiService.ts (Modified getVerificationResult to always return null)

import axios, { AxiosError } from 'axios';
import {
    AskApiResponse,
    ApiErrorResponse,
    ApiVerifyResponse, // Main structure for final results
    VerificationStatus,
    RecallLogEntryData // Structure for trace logs
} from '@/types'; // Adjust path as needed
import { QuestionData } from '../types'; // or wherever your QuestionData interface is

// --- Configuration ---
const USE_MOCK_API = false; // Set true for mock data (but getVerificationResult will ignore this now)
const MOCK_API_DELAY = 750; // Delay for /ask submission
const MOCK_STATUS_DELAY = 1500; // Delay for /status check (Not used by modified getVerificationResult)
// --- End Configuration ---

const API_BASE_URL = '/api'; // For real API calls



// --- Mock Data Generation Helpers (Keep for askQuestion if needed) ---

function createMockAskSuccessResponse(question: string, kbCid: string): AskApiResponse {
    const timestamp = Date.now();
    const contextId = `mock_ctx_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
    const recallKey = `mock_recall_${timestamp}`;
    console.log(`[Mock API - askQuestion] Generating SUCCESS response for context: ${contextId}`);
    return {
        message: `Mock request for "${question.substring(0, 20)}..." received successfully.`,
        requestContext: contextId,
        recallKey: recallKey,
    };
}



function createMockAskErrorResponse(reason: string = "Mock processing error"): ApiErrorResponse {
    console.log(`[Mock API - askQuestion] Generating ERROR response: ${reason}`);
    return { isError: true, error: `Mock Submission Failed: ${reason}`, details: `Simulated error from mock askQuestion.` };
}

// --- API Service Functions ---

/**
 * Submits a question and knowledge base CID. (Mockable)
 */
export async function askQuestion(question: string, knowledgeBaseCid: string, user: string): Promise<AskApiResponse | ApiErrorResponse> {
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
 * Fetches the status/result for a given request context ID.
 * **MODIFIED: This function now always returns null immediately without calling the backend.**
 *
 * @param requestContext The unique ID of the request to check.
 * @param originalQueryInfo Optional info about the original query (ignored now).
 */
export async function getVerificationResult(
    requestContext: string,
    originalQueryInfo?: { question: string; kbCid?: string }
): Promise<ApiVerifyResponse | ApiErrorResponse | null> { // Added null to return type
    console.log(`[API Service - getStatus] Request for context ${requestContext} received, returning null as requested.`);
    // --- MODIFIED: Always return null ---
    return null;
    // --- End Modification ---


    // --- Original MOCK API LOGIC (Now commented out) ---
    /*
    if (USE_MOCK_API) {
      console.log(`[Mock API - getStatus] Requesting status for: ${requestContext}`);
      await new Promise(resolve => setTimeout(resolve, MOCK_STATUS_DELAY));
      if (requestContext.includes("fail_status")) { return createMockStatusErrorResponse(requestContext, "Simulated network error during status check"); }
      const processingChance = Math.random();
      if (processingChance < 0.33) { console.log(`[Mock API - getStatus] Simulating 'Processing' for ${requestContext}`); return { answer: "", status: 'Processing', } as ApiVerifyResponse; }
      if (processingChance < 0.43) { return createMockFinalErrorResult(requestContext); }
      return createMockFinalResult(requestContext, originalQueryInfo?.question);
    }
    */

    // --- Original REAL API LOGIC (Now commented out) ---
    /*
    console.warn(`[API Service - getStatus] Real status check for ${requestContext} not fully implemented.`);
     try {
         const response = await axios.get<ApiVerifyResponse>(`${API_BASE_URL}/status/${requestContext}`, { timeout: 10000, headers: { 'Accept': 'application/json' } });
          if (response.data && typeof response.data.answer === 'string' && typeof response.data.status === 'string') { return response.data; }
          else { return { isError: true, error: "Invalid status response structure", details: JSON.stringify(response.data)}; }
     } catch (error: any) {
          let errorMessage = 'Unknown error fetching status.'; let errorDetails: string | undefined;
           if (axios.isAxiosError(error)) { // ... (error handling) ... }
           else { // ... (error handling) ... }
           return { isError: true, error: errorMessage, details: errorDetails };
     }
     */
}

export async function getUserQuestions(user: string): Promise<QuestionData[] | ApiErrorResponse> {
    try {
        // Adjust this path to match your Express route:
        const response = await axios.get<QuestionData[]>(`${API_BASE_URL}/questions/user/${encodeURIComponent(user)}`, {
            timeout: 15000,
            headers: { 'Accept': 'application/json' }
        });

        // If successful, just return the QuestionData[] array
        return response.data;
    } catch (error: any) {
        let errorMessage = 'Error fetching user questions.';
        let details: string | undefined = undefined;

        if (axios.isAxiosError(error)) {
            const axiosErr = error as AxiosError<any>;
            if (axiosErr.code === 'ECONNABORTED' || axiosErr.message.toLowerCase().includes('timeout')) {
                errorMessage = 'Request timed out when fetching user questions.';
            } else if (axiosErr.response) {
                const statusCode = axiosErr.response.status;
                const responseData = axiosErr.response.data;
                errorMessage = `Failed to fetch questions (${statusCode}).`;
                details = typeof responseData === 'object'
                    ? JSON.stringify(responseData)
                    : String(responseData);
            } else {
                errorMessage = 'Network error: No response.';
            }
        } else {
            errorMessage = `Unexpected error: ${String(error)}`;
        }

        return {
            isError: true,
            error: errorMessage,
            details,
        };
    }
}
// /src/services/apiService.ts