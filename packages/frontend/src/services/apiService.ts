import axios, { AxiosError } from 'axios';
// Import necessary types, including the new AskApiResponse and ApiErrorResponse
import { AskApiResponse, ApiVerifyResponse, VerificationStatus, ApiErrorResponse } from '@/types';

// Base URL will be proxied by Vite dev server to the backend
const API_BASE_URL = '/api'; // Use the proxy path

/**
 * Submits a question and an optional Knowledge Base IPFS CID to the /api/ask endpoint.
 * This endpoint initiates an asynchronous process.
 *
 * @param question The user's question string.
 * @param knowledgeBaseCid Optional IPFS Content Identifier string for the knowledge base.
 * @returns A promise resolving to either AskApiResponse on success or ApiErrorResponse on failure.
 */
export async function submitAskRequest(question: string, knowledgeBaseCid?: string): Promise<AskApiResponse | ApiErrorResponse> {
  const trimmedQuestion = question.trim();
  const trimmedKnowledgeBaseCid = knowledgeBaseCid?.trim();

  console.log(`[API Service ASK] Submitting question: "${trimmedQuestion.substring(0, 50)}..."` + (trimmedKnowledgeBaseCid ? ` with KB CID: ${trimmedKnowledgeBaseCid.substring(0, 10)}...` : ''));

  if (!trimmedQuestion) {
       console.error('[API Service ASK] Attempted to send an empty question.');
       return {
           isError: true,
           error: "Question cannot be empty.",
       };
  }

  const requestBody: { question: string; knowledgeBaseCid?: string } = {
      question: trimmedQuestion
  };
  if (trimmedKnowledgeBaseCid) {
      requestBody.knowledgeBaseCid = trimmedKnowledgeBaseCid;
  }

  try {
    // Target the /ask endpoint
    const response = await axios.post<AskApiResponse>(`${API_BASE_URL}/ask`,
      requestBody,
      {
          timeout: 30000, // Shorter timeout for initial submission (adjust if needed)
          headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
          },
      }
    );

    console.log("[API Service ASK] Received raw response status:", response.status);
    console.log("[API Service ASK] Received raw response data:", response.data);

    // --- Response Data Validation for /ask endpoint ---
    if (!response.data || typeof response.data.message !== 'string' || typeof response.data.requestContext !== 'string' || typeof response.data.recallKey !== 'string') {
         console.error("[API Service ASK] Invalid response structure received from /ask:", response.data);
         throw new Error("Received invalid or incomplete data structure from the /ask endpoint.");
    }

    console.log("[API Service ASK] Parsed successful /ask response data:", response.data);
    return response.data; // Return AskApiResponse on success

  } catch (error: any) {
    console.error('[API Service ASK] Error submitting request:', error);

    let errorMessage = 'An unknown error occurred while submitting the request.';
    let errorDetails: string | undefined = undefined;

    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<any>;

        if (axiosError.code === 'ECONNABORTED' || axiosError.message.toLowerCase().includes('timeout')) {
            errorMessage = "The request submission timed out.";
            errorDetails = `Timeout after ${axiosError.config?.timeout}ms.`;
        } else if (axiosError.response) {
            const statusCode = axiosError.response.status;
            const responseData = axiosError.response.data;
             console.error(`[API Service ASK] Server responded with error status: ${statusCode}`, responseData);
             errorMessage = `Server error (${statusCode}) during submission.`;
             // Try to get more specific error from response data
             const backendErrorMsg = (typeof responseData === 'object' && responseData !== null)
                ? responseData.error || responseData.message || responseData.detail
                : (typeof responseData === 'string' ? responseData : null);
             if (typeof backendErrorMsg === 'string' && backendErrorMsg.trim() !== '') {
                 errorMessage = backendErrorMsg;
             }
             errorDetails = `Status: ${statusCode}. Response: ${typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData).substring(0, 200)}`;

        } else if (axiosError.request) {
            console.error('[API Service ASK] No response received:', axiosError.request);
            errorMessage = "Could not connect to the server for submission.";
        } else {
            errorMessage = `Error setting up request: ${axiosError.message}`;
        }
    } else if (error instanceof Error) {
         errorMessage = error.message; // e.g., the validation error thrown above
    }

    console.error(`[API Service ASK] Processed Error: ${errorMessage} ${errorDetails ? `| Details: ${errorDetails}` : ''}`);

    // Return the structured error response
    return {
        isError: true,
        error: errorMessage,
        details: errorDetails,
    };
  }
}


// Placeholder for the function to fetch status/results later
// This would likely hit /api/status/{requestContext}
export async function getVerificationResult(requestContext: string): Promise<ApiVerifyResponse | ApiErrorResponse> {
     console.log(`[API Service STATUS] Requesting status for: ${requestContext}`);
     // TODO: Implement fetching from /api/status/{requestContext}
     // Example structure:
     // try {
     //     const response = await axios.get(`${API_BASE_URL}/status/${requestContext}`);
     //     // Validate response.data against ApiVerifyResponse structure
     //     if (/* response indicates still processing */) {
     //         return { answer: "Processing...", status: "Pending Verification" }; // Or a specific pending status
     //     }
     //     if (/* validation passes */) {
     //         return response.data as ApiVerifyResponse;
     //     } else {
     //          throw new Error("Invalid status response structure");
     //     }
     // } catch (error) {
     //      // Handle errors similar to submitAskRequest
     //      return { isError: true, error: "Failed to fetch status", details: ... }
     // }

     // Temporary placeholder response
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
      console.warn("[API Service STATUS] Status check not implemented yet.");
      return {
          isError: true,
          error: "Status check feature not implemented.",
          details: `Requested context: ${requestContext}`
      };
}


// /src/services/apiService.ts