// packages/backend/src/services/nillionService.ts
import axios, { AxiosError } from 'axios';
import config from '../config'; // Import shared config

/**
 * Handles interactions with the Nillion Secret LLM API.
 */

// Helper function to log Nillion-specific errors
function logNillionError(error: any, functionName: string): string {
     const axiosError = error as AxiosError;
     let detailedErrorMessage = axiosError.message?.split('\n')[0] || String(error);
     let statusCode: number | string = axiosError.code || 'N/A';
     console.error(`\n--- ERROR in ${functionName} [Provider: Nillion] ---`);
     if (axiosError.response) {
         statusCode = axiosError.response.status;
         console.error(`[...] API Call FAILED | Status: ${statusCode}`);
         console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2));
         detailedErrorMessage = (axiosError.response.data as any)?.error?.message || (axiosError.response.data as any)?.error || `HTTP Error ${statusCode}`;
     } else if (axiosError.request) {
         console.error(`[...] Network Error | Status: ${statusCode}`);
         detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`;
     } else {
         console.error(`[...] Setup/Request Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`);
     }
     console.error(`[...] Final Nillion Error: ${detailedErrorMessage}`);
     console.error(`--- END NILLION ERROR ---`);
     return detailedErrorMessage;
}

/**
 * Runs a chat completion request using the Nillion Secret LLM API.
 *
 * @param messages Array of chat messages in OpenAI format.
 * @param options LLM options (model, temperature, potentially max_tokens mapping).
 * @returns The response data from the Nillion API (expected to be OpenAI compatible).
 * @throws Throws an error if the API call fails or returns an error status.
 */
export async function runNillionChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options: { model: string; temperature?: number; max_tokens?: number } // Added max_tokens for potential future mapping
): Promise<any> { // Return type 'any' for now, refine if Nillion structure known
    const apiUrl = config.nilaiApiUrl;
    const apiKey = config.nilaiApiKey;
    const functionName = "nillionService.runNillionChatCompletion";

    if (!apiUrl || !apiKey) {
        console.error(`[${functionName}] Nillion API URL or Key is missing in config.`);
        throw new Error('Nillion API URL or Key not configured');
    }

    // Use model and temp from options, fallback to defaults if needed
    const model = options.model || "meta-llama/Llama-3.1-8B-Instruct"; // Default Nillion model
    const temperature = options.temperature ?? 0.1; // Default temperature

    // Construct payload for Nillion's chat completions endpoint
    const payload = {
        model: model, // Use specific model ID required by Nillion
        messages: messages,
        temperature: temperature,
        // Map max_tokens if Nillion uses a different param name e.g., 'max_length'
        // max_length: options.max_tokens
    };

    console.log(`[${functionName}] Sending request to Nillion API: ${apiUrl}/v1/chat/completions`);
    // console.log(`[${functionName}] Payload:`, JSON.stringify(payload)); // DEBUG

    try {
        const response = await axios.post(`${apiUrl}/v1/chat/completions`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            timeout: 90000 // Example timeout
        });

        // Check for non-2xx status codes which axios might not throw for by default depending on config
        if (response.status < 200 || response.status >= 300) {
             console.error(`[${functionName}] Nillion API returned non-success status: ${response.status}`);
             throw new Error(`Nillion API error: ${response.status} - ${JSON.stringify(response.data)}`);
        }

        console.log(`[${functionName}] Nillion API call successful (Status: ${response.status}).`);
        // Assuming Nillion returns data directly compatible with OpenAI chat format
        return response.data;

    } catch (error: any) {
        const errMsg = logNillionError(error, functionName);
        // Re-throw a clean error for the calling service to handle
        throw new Error(`Nillion API request failed: ${errMsg}`);
    }
}

// Add other Nillion-specific functions here if needed in the future
// e.g., analyzeClaim could be moved here if it purely uses Nillion

export default {
    runNillionChatCompletion,
    // Add other exported functions
};