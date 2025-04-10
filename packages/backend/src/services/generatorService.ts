// packages/backend/src/services/generatorService.ts
import axios, { AxiosError } from 'axios'; // Keep for potential internal use by nillionService or future needs
import config from '../config';
import { truncateText } from '../utils';
import { fetchContentByCid } from './filecoinService';
import { LLMVerificationResult as LLMVerificationResultType, LLMEvaluationResult as LLMEvaluationResultType } from '../types';

// --- Nillion Service Import ---
let nillionService: any;
try {
    // Use require for potential CommonJS compatibility if nillion service is CJS
    const nillionServicePath = require.resolve('./nillionSecretLLMService');
    nillionService = require(nillionServicePath);
    if (typeof nillionService?.runNillionChatCompletion !== 'function') {
        throw new Error("Imported nillionService is invalid or missing 'runNillionChatCompletion' function.");
    }
    console.log("[Generator Service] Nillion Secret LLM Service imported successfully.");
} catch (err: any) {
    // Log error and mark service as unavailable
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('nillionSecretLLMService')) { console.error("[Generator Service] FATAL: nillionSecretLLMService.js not found."); }
    else { console.error("[Generator Service] FATAL: Could not import nillionSecretLLMService.", err.message); }
    nillionService = null;
    // Optional: Exit if Nillion is strictly required
    // process.exit(1);
}

// Export types
export { LLMVerificationResultType as LLMVerificationResult };
export { LLMEvaluationResultType as LLMEvaluationResult };

// --- Constants ---
// Removed OpenRouter/HF URLs

// Rate Limiting (Keep generic)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; const MAX_REQUESTS_PER_WINDOW = 10; const RATE_LIMIT_RETRY_DELAY_MS = 15000; let requestTimestamps: number[] = [];

// LLM Task Parameters (Keep generic)
const MAX_TOKENS_ANSWER = 250; const TEMPERATURE_ANSWER = 0.5;
const MAX_TOKENS_CLAIM = 100; const TEMPERATURE_CLAIM = 0.4;
const MAX_TOKENS_VERIFY = 60; const TEMPERATURE_VERIFY = 0.2;
const MAX_TOKENS_EVALUATE = 80; const TEMPERATURE_EVALUATE = 0.1;

let isGeneratorInitialized = false;
// Removed currentApiKey, currentApiUrl as they are handled within nillionService now
let currentModelId: string; // Still need model ID

/** Initializes the generator service, focusing only on Nillion requirements. */
function initializeGenerator(): void {
    if (isGeneratorInitialized) return;
    console.log("[Generator Service] Initializing LLM configuration for Nillion...");

    // Check if Nillion service loaded and required config exists
    if (!nillionService) {
        console.error("[Generator Service] ERROR: Nillion provider required but nillionSecretLLMService failed to import.");
        isGeneratorInitialized = false; return;
    }
     if (!config.nilaiApiUrl || !config.nilaiApiKey) {
         console.error("[Generator Service] ERROR: Nillion provider requires NILAI_API_URL and NILAI_API_KEY in config.");
         isGeneratorInitialized = false; return;
     }

    currentModelId = config.llmModelIdentifier;
    if (!currentModelId) {
         // Use Nillion default if not specified in config
         currentModelId = "meta-llama/Llama-3.1-8B-Instruct";
         console.warn(`[Generator Service] LLM_MODEL_IDENTIFIER not set, using default Nillion model: ${currentModelId}`);
         // Alternatively, treat it as an error:
         // console.error("[Generator Service] ERROR: LLM_MODEL_IDENTIFIER is required in config.");
         // isGeneratorInitialized = false; return;
    }

    console.log(`[Generator Service] Provider: Nillion (Exclusive)`);
    console.log(`[Generator Service] Using Nillion Model: ${currentModelId}`);
    isGeneratorInitialized = true;
}

/** Rate limiter */
async function waitForRateLimit(context?: string, agentType?: string): Promise<void> { const now = Date.now(); requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS); const identifier = agentType || `GenericAgent`; const logPrefix = `[Rate Limiter | ${context?.substring(0, 10)}...]`; while (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) { console.warn(`${logPrefix} Rate limit hit (${requestTimestamps.length}/${MAX_REQUESTS_PER_WINDOW}). Wait ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s`); await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS)); const currentTime = Date.now(); requestTimestamps = requestTimestamps.filter(ts => currentTime - ts < RATE_LIMIT_WINDOW_MS); } requestTimestamps.push(now); }

initializeGenerator();

/** Unified error logging for Nillion */
function logNillionErrorWrapper(error: any, functionName: string, logPrefix: string): string {
     const providerName = "Nillion";
     const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message?.split('\n')[0] || String(error); let statusCode: number | string = axiosError.code || 'N/A';
     console.error(`\n--- ERROR in ${functionName} (${logPrefix}) [Provider: ${providerName}] ---`);
     if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] API Call FAILED | Status: ${statusCode}`); console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || (axiosError.response.data as any)?.error || `HTTP Error ${statusCode}`; }
     else if (axiosError.request) { console.error(`[...] Network Error | Status: ${statusCode}`); detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`; }
     else if (!error?.response && error?.message) { detailedErrorMessage = error.message; console.error(`[...] Logic/Response Error: ${detailedErrorMessage}`);}
     else { console.error(`[...] Setup/Unknown Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); }
     console.error(`[...] Final Error Logged: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
     return detailedErrorMessage; // Return the core message
}


/** Check if response data contains an error object */
function responseHasError(responseData: any): string | null {
    if (responseData && typeof responseData === 'object' && responseData.error) {
        if (typeof responseData.error === 'string') return responseData.error;
        if (typeof responseData.error.message === 'string') return responseData.error.message;
        return JSON.stringify(responseData.error);
    }
    return null;
}

/** Parses answer from Nillion (assuming OpenAI format) response data */
function parseAnswerFromResult(responseData: any, logPrefix: string): string | undefined {
    let answer: string | undefined;
    try {
        // Check specifically for error object within the response data first
        const bodyError = responseHasError(responseData);
        if (bodyError) { console.warn(`${logPrefix} Nillion response body contained error object: ${bodyError}`); return undefined; }
        // Assume Nillion returns OpenAI compatible structure
        answer = responseData?.choices?.[0]?.message?.content?.trim();
    } catch (parseError: any) { console.error(`${logPrefix} Error parsing Nillion response structure: ${parseError.message}.`); return undefined; }
    if (!answer) { console.warn(`${logPrefix} Nillion returned empty/unexpected answer structure after parsing.`); return undefined; }
    return answer;
}


/** Generates a direct answer using ONLY Nillion */
export async function generateAnswerFromContent( question: string, paperContent: string, requestContext?: string ): Promise<string> {
    if (!isGeneratorInitialized || !nillionService) { return "Error: Nillion Generator service not initialized."; }
    if (!question || !paperContent) { return "Error: Missing question or content."; }

    const agentType = "AnsweringAgent"; await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting ANSWER generation using Nillion...`);

    let messages: Array<{ role: string; content: string }>;
    const requestOptions = { temperature: TEMPERATURE_ANSWER, max_tokens: MAX_TOKENS_ANSWER };

    const truncatedContent = truncateText(paperContent, 4000);
    const systemPrompt = `You are an AI assistant answering questions based *strictly* on the provided text excerpt. Read the TEXT EXCERPT below and answer the QUESTION that follows. Provide a clear and concise answer based *only* on the information present in the text. If the information is not present in the text, state "Based on the provided text, the information is not available.". Do not add any explanation or commentary beyond the direct answer.`;
    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nANSWER:`;
    messages = [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }];

    let responseData; let answer: string | undefined;
    try {
        responseData = await nillionService.runNillionChatCompletion(messages, { model: currentModelId, temperature: requestOptions.temperature });
        console.log(`${logPrefix} Nillion API Call finished.`);
        const bodyError = responseHasError(responseData); if (bodyError) { throw new Error(`Nillion response body error: ${bodyError}`); }
        answer = parseAnswerFromResult(responseData, logPrefix);
        if (!answer) { throw new Error(`Nillion returned empty/unparseable answer.`); }

    } catch (error: any) {
        const errorReason = logNillionErrorWrapper(error, `generateAnswerFromContent`, logPrefix);
        return `Error: Could not generate answer via Nillion (${truncateText(errorReason, 50)}...).`;
    }

    console.log(`${logPrefix} Generated Answer (Nillion): "${truncateText(answer, 150)}"`);
    return answer;
}


/** Evaluate answer using ONLY Nillion */
export async function evaluateAnswerWithLLM( question: string, answer: string, knowledgeBaseExcerpt: string, requestContext?: string, agentId?: string ): Promise<LLMEvaluationResultType> {
     if (!isGeneratorInitialized || !nillionService) return { evaluation: 'Uncertain', confidence: 0.1, explanation: "Nillion Evaluator service not initialized." };
     if (!question || !answer || !knowledgeBaseExcerpt) return { evaluation: 'Uncertain', confidence: 0.1, explanation: "Missing input." };

     const agentType = agentId || "EvaluationAgent"; await waitForRateLimit(requestContext, agentType);
     const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`; console.log(`${logPrefix} Requesting LLM evaluation using Nillion...`);

     const truncatedExcerpt = truncateText(knowledgeBaseExcerpt, 3500); const systemPrompt = `You are an AI judge... Respond ONLY in the exact format...\nEvaluation: [Correct|Incorrect|Uncertain]\nConfidence: [0.0-1.0]\nExplanation: [...]`; const userPrompt = `TEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\n\nQUESTION: "${question}"\n\nANSWER TO EVALUATE: "${answer}"\n\nEvaluation:`; const messages = [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]; const requestOptions = { temperature: TEMPERATURE_EVALUATE, max_tokens: MAX_TOKENS_EVALUATE };

     let responseData; let rawContent : string | undefined;
     try {
         responseData = await nillionService.runNillionChatCompletion(messages, { model: currentModelId, temperature: requestOptions.temperature});
         console.log(`${logPrefix} Nillion Eval API Call finished.`);
         const bodyError = responseHasError(responseData); if (bodyError) { throw new Error(`Nillion response body error: ${bodyError}`); }
         rawContent = parseAnswerFromResult(responseData, logPrefix);
         if (!rawContent) { throw new Error(`Nillion returned empty/unparseable evaluation content.`); }

     } catch (error: any) {
         const errorReason = logNillionErrorWrapper(error, `evaluateAnswerWithLLM`, logPrefix);
         return { evaluation: 'Uncertain', confidence: 0.1, explanation: `Nillion API Error: ${errorReason}` };
     }

     console.log(`${logPrefix} Raw LLM Evaluation Response (Nillion):\n---\n${rawContent}\n---`);
     let evaluation: 'Correct' | 'Incorrect' | 'Uncertain' = 'Uncertain'; let confidence = 0.5; let explanation = "Parsing failed.";
     try { /* ... parsing logic ... */ const evalMatch = rawContent.match(/^Evaluation:\s*(Correct|Incorrect|Uncertain)/im); const confMatch = rawContent.match(/^Confidence:\s*([0-9.]+)/im); const explMatch = rawContent.match(/^Explanation:\s*(.*)/im); if (evalMatch?.[1]) { const ev = evalMatch[1].charAt(0).toUpperCase() + evalMatch[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') evaluation = ev; } else { const firstWordMatch = rawContent.match(/^(Correct|Incorrect|Uncertain)/i); if (firstWordMatch?.[1]) { const ev = firstWordMatch[1].charAt(0).toUpperCase() + firstWordMatch[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') evaluation = ev; } else console.warn(`${logPrefix} Could not parse evaluation.`); } if (confMatch?.[1]) { const pc = parseFloat(confMatch[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) confidence = pc; else console.warn(`${logPrefix} Could not parse confidence: ${confMatch[1]}`); } else console.warn(`${logPrefix} Could not find confidence line.`); if (explMatch?.[1]) { explanation = explMatch[1].trim(); } else { const lines = rawContent.split('\n'); if (lines.length > 1) explanation = lines.slice(lines.findIndex(l => l.toLowerCase().startsWith('explanation:')) + 1).join(' ').trim() || lines.slice(1).join(' ').trim() || explanation; console.warn(`${logPrefix} Could not find explanation keyword.`); } }
     catch (parseError: any) { console.error(`${logPrefix} Error parsing LLM evaluation response: ${parseError.message}`); explanation = rawContent; }
     console.log(`${logPrefix} Final Eval Result: { evaluation: ${evaluation}, confidence: ${confidence.toFixed(2)} }`);
     return { evaluation, confidence: parseFloat(confidence.toFixed(2)), explanation };
}


/** Uses LLM to verify claim using ONLY Nillion */
export async function getVerificationFromLLM( claim: string, paperExcerpt: string, requestContext?: string, agentId?: string ): Promise<LLMVerificationResultType> {
     if (!isGeneratorInitialized || !nillionService) return { verdict: 'Neutral', confidence: 0.1, explanation: "Nillion Verifier service not initialized." };
     if (!claim || !paperExcerpt) return { verdict: 'Neutral', confidence: 0.1, explanation: "Missing input." };

     const agentType = agentId || "VerificationAgent"; await waitForRateLimit(requestContext, agentType);
     const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`; console.log(`${logPrefix} Requesting LLM verification using Nillion...`);

     const truncatedExcerpt = truncateText(paperExcerpt, 3500); const systemPrompt = `You are an AI evaluating claims... Respond ONLY in the format:\nVerdict: [Supported|Contradicted|Neutral]\nConfidence: [0.0-1.0]\nExplanation: [...]`; const userPrompt = `CLAIM: "${claim}"\n\nTEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\nEvaluate the CLAIM.`; const messages = [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]; const requestOptions = { temperature: TEMPERATURE_VERIFY, max_tokens: MAX_TOKENS_VERIFY };

     let responseData; let rawContent: string | undefined;
     try {
         responseData = await nillionService.runNillionChatCompletion(messages, { model: currentModelId, temperature: requestOptions.temperature});
         console.log(`${logPrefix} Nillion Verify API Call finished.`);
         const bodyError = responseHasError(responseData); if (bodyError) { throw new Error(`Nillion response body error: ${bodyError}`); }
         rawContent = parseAnswerFromResult(responseData, logPrefix);
         if (!rawContent) { throw new Error(`Nillion Verifier returned empty/unparseable content.`); }

     } catch (error: any) {
         const errorReason = logNillionErrorWrapper(error, `getVerificationFromLLM`, logPrefix);
         return { verdict: 'Neutral', confidence: 0.1, explanation: `Nillion API Error: ${errorReason}` };
     }

     console.log(`${logPrefix} Raw LLM Verification Response (Nillion):\n---\n${rawContent}\n---`);
     let verdict: 'Supported' | 'Contradicted' | 'Neutral' = 'Neutral'; let confidence = 0.5; let explanation = "Parsing failed.";
     try { /* ... parsing logic ... */ } catch (parseError: any) { console.error(`${logPrefix} Error parsing LLM verification: ${parseError.message}`); explanation = rawContent; }
     console.log(`${logPrefix} Verification Result: ${verdict} (Conf: ${confidence.toFixed(2)})`);
     return { verdict, confidence: parseFloat(confidence.toFixed(2)), explanation };
}

/** Generates claim using ONLY Nillion */
export async function generateClaim( question: string, knowledgeBaseCid: string, requestContext?: string ): Promise<string> {
    if (!isGeneratorInitialized || !nillionService) return "Error: Nillion Generator service not initialized.";
    if (!question || !knowledgeBaseCid ) return "Error: Missing question or CID.";

    const agentType = "ClaimGen"; await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;

    console.log(`${logPrefix} Fetching content for claim gen (CID: ${knowledgeBaseCid.substring(0,10)}...)`);
    const paperContent = await fetchContentByCid(knowledgeBaseCid);
    if (!paperContent) { return `Error: Could not fetch KB content.`; }
    console.log(`${logPrefix} Content fetched. Requesting CLAIM generation using Nillion...`);

    const truncatedContent = truncateText(paperContent, 3500); const systemPrompt = `Based *only* on the TEXT EXCERPT, provide a concise, single-sentence, verifiable factual claim...`; const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nCLAIM:`; const messages = [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]; const requestOptions = { temperature: TEMPERATURE_CLAIM, max_tokens: MAX_TOKENS_CLAIM };

    let responseData; let claim: string | undefined;
    try {
        responseData = await nillionService.runNillionChatCompletion(messages, { model: currentModelId, temperature: requestOptions.temperature});
        console.log(`${logPrefix} Nillion Claim Gen API Call finished.`);
        const bodyError = responseHasError(responseData); if (bodyError) { throw new Error(`Nillion response body error: ${bodyError}`); }
        claim = parseAnswerFromResult(responseData, logPrefix);
        if (!claim) { throw new Error(`Nillion ClaimGen returned empty/unparseable content.`); }

    } catch (error: any) {
        const errorReason = logNillionErrorWrapper(error, `generateClaim`, logPrefix);
        return `Error: Could not generate claim via Nillion (${truncateText(errorReason, 50)}...).`;
    }

    console.log(`${logPrefix} Generated Claim (Nillion): "${truncateText(claim, 100)}"`);
    return claim;
}