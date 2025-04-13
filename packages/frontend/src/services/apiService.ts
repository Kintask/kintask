// kintask/packages/frontend/src/services/apiService.ts

import axios, { AxiosError } from 'axios';
import {
    AskQuestionResponse, // Use updated type name
    ApiErrorResponse,
    // ApiVerifyResponse, // Replaced by FinalVerificationResult potentially
    FinalVerificationResult, // Use this for final combined structure
    QuestionData,
    EvaluationData, // Import this type
    EvaluationResult,
    AnswerData
} from '@/types'; // Adjust path as needed if using aliases, otherwise use relative path './types'


const API_BASE_URL = '/api'; // For real API calls (uses Vite proxy)
const DEFAULT_TIMEOUT = 600000; // Default timeout for requests

// Create a base axios instance with common headers
const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'ngrok-skip-browser-warning': 'true' // Added to bypass ngrok warning
    }
});

// --- Helper for Error Handling ---
function formatError(error: any, context?: string): ApiErrorResponse {
    const axiosError = error as AxiosError<any>;
    console.error(`[API Service${context ? ` ${context}`: ''}] Error:`, axiosError.message);
    let errorMessage = 'An unknown API error occurred.';
    let errorDetails: any = axiosError.stack;
    let status = axiosError.response?.status;
    if (axiosError.response?.data) {
        if (typeof axiosError.response.data === 'string') { errorMessage = axiosError.response.data; }
        else if (typeof axiosError.response.data.error === 'string') { errorMessage = axiosError.response.data.error; if (axiosError.response.data.message) errorMessage += `: ${axiosError.response.data.message}`; else if (axiosError.response.data.details) errorDetails = axiosError.response.data.details; }
        else if (typeof axiosError.response.data.message === 'string') { errorMessage = axiosError.response.data.message; }
    } else if (axiosError.message) { errorMessage = axiosError.message; }
    console.error(`[API Service] Formatted Error: ${errorMessage}`, errorDetails);
    return { isError: true, error: errorMessage, details: errorDetails, status };
}

// --- API Service Functions ---

/**
 * Submits a question, knowledge base CID, and user address.
 * POST /api/ask (or /api/verify - ensure backend route matches)
 */
export async function askQuestion(question: string, knowledgeBaseCid: string, user: string): Promise<AskQuestionResponse | ApiErrorResponse> {
    const trimmedQuestion = question.trim();
    const trimmedKnowledgeBaseCid = knowledgeBaseCid.trim();
    console.log(trimmedKnowledgeBaseCid)
    // --- REAL API LOGIC ---
    console.log(`[API Service - askQuestion] Submitting request for user ${user.substring(0,6)}...`);
    if (!trimmedQuestion) { return { isError: true, error: "Question cannot be empty." }; }
    // Basic CID check
    if (!trimmedKnowledgeBaseCid || !(trimmedKnowledgeBaseCid.startsWith('Qm') || trimmedKnowledgeBaseCid.startsWith('baf') )) {
        return { isError: true, error: "Invalid or missing Knowledge Base CID format." };
    }
    const requestBody = { question: trimmedQuestion, knowledgeBaseCid: trimmedKnowledgeBaseCid, user }; // Match backend payload { question, cid, user }
    try {
        // IMPORTANT: Ensure this endpoint matches your backend route (e.g., /api/ask or /api/verify)
        const response = await apiClient.post<AskQuestionResponse>(`/ask`, requestBody);
        // Validate expected fields in success response
        if (!response.data || typeof response.data !== 'object' || typeof response.data.requestContext !== 'string') {
             console.error("[API Service - askQuestion] Unexpected success response structure:", response.data);
             return { isError: true, error: "Unexpected server acknowledgement response structure. "+response.data.status, details: JSON.stringify(response.data) };
        }
        console.log("[API Service - askQuestion] Success:", response.data);
        return response.data;
    } catch (error: any) {
        return formatError(error, `askQuestion`);
    }
}

/**
 * Fetches the status/result for a given request context ID.
 * **MODIFIED: This function now always returns null immediately without calling the backend.**
 */
export async function getVerificationResult(
    requestContext: string,
    originalQueryInfo?: { question: string; kbCid?: string } // Parameter is ignored now
): Promise<any | ApiErrorResponse | null> { // Use 'any' or a specific final result type if needed
    console.warn(`[API Service - getVerificationResult] FUNCTION DEPRECATED/MODIFIED: Request for context ${requestContext} received, returning null immediately.`);
    return null; // Always return null
}

/**
 * Fetches all past questions submitted by a user.
 * GET /api/questions/user/:userAddress
 */
export async function getUserQuestions(user: string): Promise<QuestionData[] | ApiErrorResponse> {
     if (!user || typeof user !== 'string') return { isError: true, error: "Valid user address is required." };
    try {
        console.log(`[API Service] GET /api/questions/user/${user.substring(0,10)}...`);
        const response = await apiClient.get<QuestionData[]>(`/questions/user/${encodeURIComponent(user)}`);
        console.log(response)
        if (!Array.isArray(response.data)) {
             throw new Error("Invalid history response format from backend: Expected an array.");
        }
        console.log(`[API Service] GET /api/questions/user - Success: Received ${response.data.length} entries.`);
        return response.data;
    } catch (error: any) {
        return formatError(error, `getUserQuestions(${user.substring(0,6)})`);
    }
}

/**
 * Fetches the answer(s) submitted for a specific request context.
 * GET /api/answers/:contextId
 */
export async function fetchAnswersForQuestion(contextId: string): Promise<AnswerData[] | ApiErrorResponse> {
     if (!contextId) return { isError: true, error: "Request context ID is required." };
    try {
        console.log(`[API Service] GET /api/answers/${contextId}`);
        const response = await apiClient.get<AnswerData[]>(`/answers/${encodeURIComponent(contextId)}`);
         if (!Array.isArray(response.data)) {
             throw new Error("Invalid answers response format from backend: Expected an array.");
         }
         console.log(`[API Service] GET /api/answers - Success: Received ${response.data.length} answer(s) for ${contextId}.`);
        return response.data;
    } catch (error: any) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 404) {
             console.log(`[API Service] GET /api/answers - No answers found yet (404) for ${contextId}.`);
             return []; // Return empty array if 404 (means processing, not error)
        }
        return formatError(error, `fetchAnswersForQuestion(${contextId})`);
    }
}


/**
 * Fetches the evaluation data (results, status) for a specific request context.
 * GET /api/evaluation-data/:contextId
 */
export async function fetchEvaluationData(contextId: string): Promise<EvaluationData | ApiErrorResponse> {
     if (!contextId) return { isError: true, error: "Request context ID is required." };
    try {
        console.log(`[API Service] GET /api/evaluation-data/${contextId}`);
        const response = await apiClient.get<EvaluationData>(`/evaluation-data/${encodeURIComponent(contextId)}`);
         // Basic validation
         if (!response.data || typeof response.data !== 'object' || !response.data.requestContext) {
              throw new Error("Invalid evaluation data response format from backend.");
         }
          console.log(`[API Service] GET /api/evaluation-data - Success for ${contextId}. Status: ${response.data.status}`);
        return response.data;
    } catch (error: any) {
         const axiosError = error as AxiosError;
         if (axiosError.response?.status === 404) {
              console.log(`[API Service] GET /api/evaluation-data - Evaluation data not ready yet (404) for ${contextId}.`);
              // Return specific error for 404 to indicate "still processing"
              return { isError: true, error: `Evaluation data not ready for ${contextId}`, status: 404 };
         }
        return formatError(error, `fetchEvaluationData(${contextId})`);
    }
}


/**
 * Checks if a question has been evaluated by calling GET /api/check-evaluation/:context
 * Returns an object { evaluated: boolean, message: string, status?: string } or an ApiErrorResponse.
 * We add status to the success response for more polling info.
 */
export async function checkEvaluationStatus(contextId: string): Promise<{ evaluated: boolean; message: string; status?: string } | ApiErrorResponse> {
    if (!contextId) return { isError: true, error: "Request context ID is required." };
    try {
      console.log(`[API Service] GET /api/check-evaluation/${contextId}`);
      // Assume backend returns { evaluated: boolean, message: string, status?: string }
      const response = await apiClient.get<{ evaluated: boolean; message: string, status?: string }>(
        `/check-evaluation/${encodeURIComponent(contextId)}`
      );
       if (typeof response.data?.evaluated !== 'boolean') {
            throw new Error("Invalid check-evaluation response structure from backend.");
       }
       console.log(`[API Service] GET /api/check-evaluation - Success for ${contextId}. Evaluated: ${response.data.evaluated}, Status: ${response.data.status}`);
      return response.data; // Contains { evaluated, message, status? }
    } catch (error: any) {
         const axiosError = error as AxiosError;
         if (axiosError.response?.status === 404) {
              console.log(`[API Service] GET /api/check-evaluation - Evaluation status not found yet (404) for ${contextId}. Assuming not evaluated.`);
              // Return specific structure for "not ready"
              return { evaluated: false, message: "Evaluation pending or context not found.", status: "Pending Evaluation"};
         }
        return formatError(error, `checkEvaluationStatus(${contextId})`);
    }
}


// --- Combined Polling Function ---

/**
 * Polls evaluation status and fetches final results when ready.
 */
export async function pollForResult(
    contextId: string,
    originalQuestion: string, // Needed to construct FinalVerificationResult
    kbCid: string // Needed to construct FinalVerificationResult
): Promise<Partial<FinalVerificationResult> | ApiErrorResponse> { // Return Partial as it might be intermediate
    if (!contextId) return { isError: true, error: "Context ID needed for polling." };

    try {
        // 1. Check Evaluation Status first (primary check)
        const statusCheckResponse = await checkEvaluationStatus(contextId);

        if ('isError' in statusCheckResponse) {
             // Error checking status - return polling error
             return { ...statusCheckResponse, requestContext: contextId, question: originalQuestion, kbCid: kbCid, status: 'Error: Polling Failed' };
        }

        const currentStatus = statusCheckResponse.status || (statusCheckResponse.evaluated ? 'Unknown Completed' : 'Processing');
        console.log(`[Polling ${contextId}] Status Check: Evaluated=${statusCheckResponse.evaluated}, Message=${statusCheckResponse.message}, CurrentStatus=${currentStatus}`);


        if (!statusCheckResponse.evaluated) {
            // Still processing, return intermediate status
            return { requestContext: contextId, status: currentStatus, question: originalQuestion, kbCid: kbCid };
        }

        // --- Evaluation is marked as complete, fetch details ---
        console.log(`[Polling ${contextId}] Evaluation complete. Fetching Answer and Evaluation details...`);

        // 2. Fetch Evaluation Data (now that we know it should exist)
        const evalResponse = await fetchEvaluationData(contextId);
        if ('isError' in evalResponse) {
            console.error(`[Polling ${contextId}] Error fetching evaluation data even after status check passed:`, evalResponse.error);
            return { ...evalResponse, requestContext: contextId, question: originalQuestion, kbCid: kbCid, status: 'Error: Evaluation Failed' };
        }
        const finalEvalStatus = evalResponse.status; // Get final status from eval data

        // 3. Fetch Answers
        const answerResponse = await fetchAnswersForQuestion(contextId);
        let finalAnswerText: string | undefined = "[Answer Unavailable]";
        let answeringAgentId: string | undefined = undefined;
        let answerTimestamp: string | undefined = undefined;

        if ('isError' in answerResponse) {
            console.warn(`[Polling ${contextId}] Failed to fetch final answers: ${answerResponse.error}`);
        } else if (answerResponse.length > 0) {
            finalAnswerText = answerResponse[0].answer; // Assume first answer
            answeringAgentId = answerResponse[0].answeringAgentId;
            answerTimestamp = answerResponse[0].timestamp;
        } else {
             console.log(`[Polling ${contextId}] No answers found for completed request ${contextId}.`);
             finalAnswerText = "[No answer submitted]";
        }

        // 4. Construct Final Result Object
        let primaryEvaluation: EvaluationResult | undefined = evalResponse.results?.[0];

        const finalResult: FinalVerificationResult = {
            requestContext: contextId,
            question: originalQuestion,
            kbCid: kbCid,
            answer: finalAnswerText,
            evaluation: primaryEvaluation?.evaluation || 'N/A',
            confidence: primaryEvaluation?.confidence,
            explanation: primaryEvaluation?.explanation,
            status: finalEvalStatus, // Use status from evaluation data
            answerTimestamp: answerTimestamp,
            evaluationTimestamp: evalResponse.timestamp,
            answeringAgentId: answeringAgentId || primaryEvaluation?.answeringAgentId,
            evaluatorAgentId: evalResponse.evaluatorAgentId,
            // recallTrace: // TODO: Fetch trace data separately if needed
            error: finalEvalStatus.includes('Failed') || finalEvalStatus.includes('Error') ? `Processing ended with status: ${finalEvalStatus}` : undefined,
        };

        console.log(`[Polling ${contextId}] Constructed final result:`, finalResult);
        return finalResult; // Return the full final result

    } catch (error) {
        console.error(`[Polling ${contextId}] Critical error during polling process:`, error);
        return formatError(error, `pollForResult(${contextId})`);
    }
}