// kintask/packages/backend/src/services/generatorService.ts
import axios, { AxiosError } from 'axios'; // Using axios for HTTP requests
import config from '../config'; // Import configuration (includes API key)
import { logRecallEvent } from './recallService'; // Import recall logger for errors


const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = config.openRouterApiKey;

// --- Model Configuration ---
// ACTION REQUIRED: Choose a model available on OpenRouter.
// Check https://openrouter.ai/models for options and pricing.
// Using the free Mistral model as a default.
const MODEL_IDENTIFIER = "mistralai/mistral-7b-instruct:free";
// --- End Model Configuration ---

// --- Generation Parameters ---
const MAX_TOKENS = 250; // Max length of the generated response
const TEMPERATURE = 0.5; // Lower value = more deterministic, higher = more creative
const TOP_P = 0.9;      // Nucleus sampling
// --- End Generation Parameters ---

let isGeneratorInitialized = false;

function initializeGenerator() {
    if (isGeneratorInitialized) return;
    console.log("[Generator Service] Initializing OpenRouter configuration...");
    if (!API_KEY) {
        // This case should be caught by config.ts validation, but double-check
        console.error("[Generator Service] FATAL ERROR: OPENROUTER_API_KEY is not configured.");
        isGeneratorInitialized = false;
        return; // Prevent setting initialized flag
    }
     console.log(`[Generator Service] Configured to use OpenRouter model: ${MODEL_IDENTIFIER}`);
    isGeneratorInitialized = true;
}

// Ensure service is initialized before first use (lazy initialization)
// initializeGenerator(); // Call this explicitly in server startup if preferred


export async function generateAnswer(question: string, requestContext?: string): Promise<string> {
    if (!isGeneratorInitialized) initializeGenerator(); // Ensure initialized

    if (!API_KEY || !isGeneratorInitialized) {
        console.error("[Generator Service] OpenRouter API Key not configured or service failed initialization.");
        return "Error: AI answer generation service is not available."; // Return error string
    }
    if (!question || question.trim() === '') {
        console.warn("[Generator Service] Received empty question.");
        return "Error: Cannot generate answer for empty question.";
    }

    console.log(`[Generator Service Request: ${requestContext}] Requesting OpenRouter (${MODEL_IDENTIFIER}) answer...`);

    // --- Construct Payload for OpenRouter (OpenAI compatible format) ---
    const systemPrompt = 'You are Kintask, a helpful AI assistant. Provide concise, factual answers based on general knowledge. Avoid hedging or apologies.';
    const payload = {
        model: MODEL_IDENTIFIER,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question }
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        top_p: TOP_P,
        // stream: false, // Explicitly disable streaming for simple request/response
    };
    // --- End Payload Construction ---

    try {
        const response = await axios.post(
            OPENROUTER_API_URL,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json',
                    // Recommended headers for OpenRouter analytics/tracking
                    'HTTP-Referer': `http://localhost:${config.port || 3001}`, // Use configured port
                    'X-Title': 'Kintask Hackathon', // Your App Name
                },
                timeout: 60000 // 60 second timeout for API call
            }
        );

        // --- Process OpenRouter Response ---
        const choice = response.data?.choices?.[0];
        const answer = choice?.message?.content?.trim();
        const finishReason = choice?.finish_reason;

        console.log(`[Generator Service Request: ${requestContext}] Finish Reason: ${finishReason || 'N/A'}`);

        if (finishReason === 'length') {
            console.warn(`[Generator Service Request: ${requestContext}] OpenRouter response truncated due to max_tokens limit.`);
            // Return the truncated answer, the user might still find it useful
        } else if (finishReason !== 'stop' && finishReason !== null) {
             console.warn(`[Generator Service Request: ${requestContext}] Unusual finish reason: ${finishReason}.`);
        }

        if (!answer) {
            console.warn(`[Generator Service Request: ${requestContext}] OpenRouter returned empty answer content. Response:`, JSON.stringify(response.data).substring(0, 200) + "...");
            // Check for explicit errors in the response structure
            const errorMsg = (response.data as any)?.error?.message || 'The AI model did not provide a valid text answer.';
            // Log this failure to Recall
             if (requestContext) {
                 logRecallEvent('VERIFICATION_ERROR', { step: 'GeneratorParse', error: errorMsg, responseData: response.data }, requestContext)
                    .catch(err => console.error("Error logging generator parse error to recall:", err));
             }
            return `Error: ${errorMsg}`;
        }
        // --- End Response Processing ---

        console.log(`[Generator Service Request: ${requestContext}] Received OpenRouter answer (truncated): "${answer.substring(0, 100)}..."`);
        return answer;

    } catch (error: any) {
        const axiosError = error as AxiosError;
        console.error(`[Generator Service Request: ${requestContext}] Error fetching answer from OpenRouter:`, axiosError.message);

        let detailedErrorMessage = axiosError.message;
        let responseDataForLog: any = null;

        if (axiosError.response) {
            console.error(`  Status: ${axiosError.response.status}`);
            const responseData = axiosError.response.data;
            responseDataForLog = responseData; // Log the actual response data if available
            console.error('  Response Data:', JSON.stringify(responseData).substring(0, 300) + "...");
            // Extract specific error message from OpenRouter/model if available
            detailedErrorMessage = (responseData as any)?.error?.message || `HTTP Error ${axiosError.response.status}`;
        } else if (axiosError.request) {
             console.error('  No response received from OpenRouter.');
             detailedErrorMessage = 'No response received from OpenRouter service.';
        } else {
             console.error('  Error setting up OpenRouter request:', error.message);
             detailedErrorMessage = `Request setup error: ${error.message}`;
        }

        // Log error details to Recall
        if (requestContext) {
            logRecallEvent('VERIFICATION_ERROR', { step: 'GeneratorAPI', error: detailedErrorMessage, responseData: responseDataForLog }, requestContext)
                .catch(err => console.error("Error logging generator API error to recall:", err));
        }

        return `Error: Could not retrieve answer from the AI model (${detailedErrorMessage.substring(0, 80)}...).`; // Return user-friendly error
    }
}