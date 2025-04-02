import axios, { AxiosError } from 'axios';
import { ApiVerifyResponse, VerificationStatus } from '@/types'; // Use local type definition & path alias

// Base URL will be proxied by Vite dev server to the backend
// Do NOT include localhost here, Vite proxy handles it
const API_BASE_URL = '/api';

/**
 * Sends a question to the backend /api/verify endpoint.
 * Handles API calls and basic error structuring.
 * @param question The user's question string.
 * @returns A promise resolving to the ApiVerifyResponse object.
 */
export async function sendMessage(question: string): Promise<ApiVerifyResponse> {
  console.log(`[API Service] Sending question: "${question.substring(0, 50)}..."`);

  // Basic input check
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
       console.error('[API Service] Attempted to send an empty question.');
       return {
           answer: "Cannot send an empty question.",
           status: "Error: Verification Failed",
           error: "Invalid input: Question cannot be empty.",
       };
  }

  try {
    // Use the proxied path
    const response = await axios.post<ApiVerifyResponse>(`${API_BASE_URL}/verify`,
      { question: question.trim() }, // Send trimmed question
      {
          timeout: 90000, // Increase timeout (90s) to allow for complex verification + LLM + network
          headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
          },
      }
    );

    console.log("[API Service] Received raw response:", response);

    // --- Response Data Validation ---
    // Check if response.data exists and has the essential fields
    if (!response.data || typeof response.data.answer !== 'string' || typeof response.data.status !== 'string') {
         console.error("[API Service] Invalid response structure received:", response.data);
         throw new Error("Received invalid or incomplete data structure from the backend.");
    }

    // Optional: More specific type checks if needed (e.g., confidence is number or undefined)
    if (response.data.confidence !== undefined && typeof response.data.confidence !== 'number') {
         console.warn("[API Service] Received confidence value is not a number:", response.data.confidence);
         // Decide how to handle - nullify it or keep potentially bad data?
         // response.data.confidence = undefined;
    }
    // ... add checks for other fields like usedFragmentCids (array), recallTrace (array) ...

    console.log("[API Service] Parsed response data:", response.data);
    return response.data;

  } catch (error: any) {
    console.error('[API Service] Error sending message or processing response:', error);

    let errorStatus: VerificationStatus = "Error: Verification Failed";
    let errorMessage = 'An unknown API error occurred.';
    let errorDetails: string | undefined = undefined;

    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiVerifyResponse>; // Type assertion for Axios errors
        if (axiosError.code === 'ECONNABORTED' || axiosError.message.toLowerCase().includes('timeout')) {
            errorMessage = "The request timed out. The server might be busy or the verification process took too long.";
            errorDetails = `Timeout after ${axiosError.config?.timeout}ms.`;
        } else if (axiosError.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('[API Service] Server responded with error status:', axiosError.response.status, axiosError.response.data);
            errorMessage = `Server error: ${axiosError.response.status}`;
            // Try to use error message from backend response body if available
            if (axiosError.response.data?.error) {
                errorMessage = axiosError.response.data.error;
                errorDetails = axiosError.response.data.details;
            } else if (typeof axiosError.response.data === 'string') {
                 errorDetails = axiosError.response.data; // Use raw response if it's just a string
            }
             // Map HTTP status to VerificationStatus if needed (e.g., 400 -> Error)
             // errorStatus = mapHttpStatusToVerificationStatus(axiosError.response.status);
        } else if (axiosError.request) {
            // The request was made but no response was received
            console.error('[API Service] No response received:', axiosError.request);
            errorMessage = "Could not connect to the server. Please check if the backend is running.";
        } else {
            // Something happened in setting up the request that triggered an Error
            errorMessage = `Error setting up request: ${axiosError.message}`;
        }
    } else if (error instanceof Error) {
         // Non-Axios error (e.g., validation error thrown above, or other unexpected issue)
         errorMessage = error.message;
    }

    console.error(`[API Service] Processed Error: ${errorMessage} ${errorDetails ? `(${errorDetails})` : ''}`);

    // Return a structured error response for the UI
    return {
        answer: "An error occurred while processing your request.", // Generic answer on error
        status: errorStatus, // Default error status
        error: errorMessage,
        details: errorDetails,
    };
  }
}
