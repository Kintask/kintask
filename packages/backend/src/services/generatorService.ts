// src/services/generatorService.ts
import axios, { AxiosError } from 'axios';
import config from '../config';
import { truncateText } from '../utils';
import { fetchContentByCid } from './filecoinService'; // Import CID fetcher

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = config.openRouterApiKey; // Ensure API key is loaded from config
const MODEL_IDENTIFIER = "mistralai/mistral-7b-instruct:free"; // Or choose another suitable model

// Rate Limiting Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds window
const MAX_REQUESTS_PER_WINDOW = 10; // Allow 10 requests per minute (adjust as needed)
const RATE_LIMIT_RETRY_DELAY_MS = 15000; // Wait 15 seconds if limit is hit
let requestTimestamps: number[] = [];

// --- Constants for different LLM tasks ---
const MAX_TOKENS_ANSWER = 250;
const TEMPERATURE_ANSWER = 0.5;
const MAX_TOKENS_CLAIM = 100;
const TEMPERATURE_CLAIM = 0.4;
const MAX_TOKENS_VERIFY = 50;
const TEMPERATURE_VERIFY = 0.2;

let isGeneratorInitialized = false;

/**
 * Initializes the generator service, checks API key.
 */
function initializeGenerator(): void {
    if (isGeneratorInitialized) return;
    console.log("[Generator Service] Initializing OpenRouter configuration...");
    if (!API_KEY) {
        console.error("[Generator Service] ERROR: OPENROUTER_API_KEY variable is missing or not loaded.");
        isGeneratorInitialized = false;
        return;
    }
    console.log(`[Generator Service] Using API Key starting with: ${API_KEY.substring(0, 10)}...`);
    console.log(`[Generator Service] Configured model: ${MODEL_IDENTIFIER}`);
    isGeneratorInitialized = true;
}

/**
 * Simple rate limiter middleware function. Waits if request limit is hit.
 */
async function waitForRateLimit(context?: string, agentType?: string): Promise<void> {
    const now = Date.now();
    requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    const identifier = agentType || `GenericAgent`;
    const logPrefix = `[Rate Limiter - ${identifier} | ${context?.substring(0, 10)}...]`;

    while (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        console.warn(`${logPrefix} Rate limit hit (${requestTimestamps.length}/${MAX_REQUESTS_PER_WINDOW}). Waiting ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
        const currentTime = Date.now();
        requestTimestamps = requestTimestamps.filter(ts => currentTime - ts < RATE_LIMIT_WINDOW_MS);
    }
    requestTimestamps.push(now);
}

// --- Ensure initialization is called when module loads ---
initializeGenerator();


/**
 * Generates a direct answer to the question based on the provided content.
 * @param question The question to answer.
 * @param paperContent The content of the knowledge base document.
 * @param requestContext Optional context for logging.
 * @returns A promise that resolves to the generated answer string or an error message.
 */
export async function generateAnswerFromContent( // Ensure EXPORT keyword is present
    question: string,
    paperContent: string,
    requestContext?: string
): Promise<string> {
    if (!isGeneratorInitialized) { return "Error: Generator service not initialized (Missing API Key?)."; }
    if (!question || question.trim() === '') { return "Error: Cannot generate answer for empty question."; }
    if (!paperContent || paperContent.trim() === '') { return "Error: Cannot generate answer from empty content."; }

    const agentType = "AnsweringAgent"; // Identify the type of agent using this
    await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting ANSWER generation...`);

    const systemPrompt =
        `You are an AI assistant answering questions based *strictly* on the provided text excerpt.
Read the TEXT EXCERPT below and answer the QUESTION that follows.
Provide a clear and concise answer based *only* on the information present in the text.
If the information is not present in the text, state "Based on the provided text, the information is not available.".
Do not add any explanation or commentary beyond the direct answer.`;

    const truncatedContent = truncateText(paperContent, 4000); // Adjust size as needed

    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nANSWER:`;

    const payload = {
        model: MODEL_IDENTIFIER,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: TEMPERATURE_ANSWER,
        top_p: 0.9,
    };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': `http://localhost:${config.port || 3001}`,
                'X-Title': 'Kintask AnswerGen',
            },
            timeout: 90000
        });
        console.log(`${logPrefix} Answer Gen API Call Successful | Status: ${response.status}`);
        const answer = response.data?.choices?.[0]?.message?.content?.trim();

        if (!answer) { throw new Error("LLM returned empty answer content."); }

        console.log(`${logPrefix} Generated Answer: "${truncateText(answer, 150)}"`);
        return answer;

    } catch (error: any) {
        const axiosError = error as AxiosError;
        let detailedErrorMessage = axiosError.message.split('\n')[0];
        let statusCode: number | string = axiosError.code || 'N/A';

        console.error(`\n--- ERROR in generateAnswerFromContent (${logPrefix}) ---`);
        if (axiosError.response) {
            statusCode = axiosError.response.status;
            console.error(`[...] API Call FAILED | Status: ${statusCode}`);
            console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2));
            detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`;
        } else if (axiosError.request) {
            console.error(`[...] Network Error | Status: ${statusCode} | Request timed out or no response received.`);
            detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`;
        } else {
            console.error(`[...] Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`);
        }
        console.error(`[...] Final Error generating answer: ${detailedErrorMessage}`);
        console.error(`--- END ERROR ---`);
        return `Error: Could not generate answer (${detailedErrorMessage.substring(0, 50)}...).`;
    }
}


/**
 * Interface representing the structured result of LLM verification.
 */
export interface LLMVerificationResult {
    verdict: 'Supported' | 'Contradicted' | 'Neutral';
    confidence: number; // 0.0 - 1.0
    explanation?: string; // Brief explanation
}

/**
 * Uses LLM to verify if a given claim is supported by the provided text excerpt.
 */
export async function getVerificationFromLLM( // Ensure EXPORT keyword is present
    claim: string,
    paperExcerpt: string,
    requestContext?: string,
    agentId?: string
): Promise<LLMVerificationResult> {
    if (!isGeneratorInitialized) {
        console.error(`[Verifier Agent ${agentId} Error] Generator Service not initialized (Missing API Key?).`);
        return { verdict: 'Neutral', confidence: 0.1, explanation: "Verifier LLM misconfigured (API Key missing?)." };
    }
    if (!claim || !paperExcerpt) {
        console.error(`[Verifier Agent ${agentId} Error] Missing claim or paper excerpt for verification.`);
        return { verdict: 'Neutral', confidence: 0.1, explanation: "Missing input for verification." };
    }

    const agentType = agentId || "VerificationAgent";
    await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting LLM verification for claim...`);

    const systemPrompt = `You are an AI evaluating claims against a text excerpt. Analyze the TEXT EXCERPT to determine if it supports, contradicts, or is neutral towards the CLAIM. Respond ONLY in the format:\nVerdict: [Supported|Contradicted|Neutral]\nConfidence: [0.0-1.0]\nExplanation: [1 sentence concisely explaining the reasoning based *only* on the text.]`;

    const truncatedExcerpt = truncateText(paperExcerpt, 3500);
    const userPrompt = `CLAIM: "${claim}"\n\nTEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\nBased *only* on the TEXT EXCERPT, evaluate the CLAIM.`;

    const payload = {
        model: MODEL_IDENTIFIER,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: MAX_TOKENS_VERIFY,
        temperature: TEMPERATURE_VERIFY
    };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': `http://localhost:${config.port || 3001}`, 'X-Title': 'Kintask VerifierLLM', },
            timeout: 60000
        });
        console.log(`${logPrefix} Verify LLM API Call Successful | Status: ${response.status}`);
        const content = response.data?.choices?.[0]?.message?.content?.trim();
        if (!content) { throw new Error("LLM Verifier returned empty content."); }

        // Parsing logic
        let verdict: 'Supported' | 'Contradicted' | 'Neutral' = 'Neutral'; let confidence = 0.5; let explanation = "Could not parse LLM response.";
        const verdictMatch = content.match(/Verdict:\s*(Supported|Contradicted|Neutral)/i); const confidenceMatch = content.match(/Confidence:\s*([0-9.]+)/i); const explanationMatch = content.match(/Explanation:\s*(.*)/i);
        if (verdictMatch?.[1]) { const fv = verdictMatch[1].charAt(0).toUpperCase() + verdictMatch[1].slice(1).toLowerCase(); if (fv === 'Supported' || fv === 'Contradicted' || fv === 'Neutral') { verdict = fv; } }
        if (confidenceMatch?.[1]) { const pc = parseFloat(confidenceMatch[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) { confidence = pc; } else { console.warn(`${logPrefix} Could not parse confidence value: ${confidenceMatch[1]}`); } } else { console.warn(`${logPrefix} Could not find confidence value in response.`); }
        if (explanationMatch?.[1]) { explanation = explanationMatch[1].trim(); } else { console.warn(`${logPrefix} Could not find explanation in response.`); }

        console.log(`${logPrefix} Verification Result: ${verdict} (Conf: ${confidence.toFixed(2)})`);
        return { verdict, confidence: parseFloat(confidence.toFixed(2)), explanation };

    } catch (error: any) {
        const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message.split('\n')[0]; let statusCode: number | string = axiosError.code || 'N/A';
        console.error(`\n--- ERROR in getVerificationFromLLM (${logPrefix}) ---`);
        if (axiosError.response) { /* ... error logging ... */ } else if (axiosError.request) { /* ... error logging ... */ } else { /* ... error logging ... */ }
        console.error(`[...] Final Error for LLM call: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
        return { verdict: 'Neutral', confidence: 0.1, explanation: `LLM API Error: ${detailedErrorMessage}` };
    }
}


// --- generateClaim function ---
// Kept here if the synchronous /verify endpoint still needs it.
// Ensure EXPORTED if needed by verifyController.
export async function generateClaim( // Ensure EXPORT keyword is present if needed
    question: string,
    knowledgeBaseCid: string,
    requestContext?: string
): Promise<string> {
    if (!isGeneratorInitialized) { return "Error: Generator service not initialized (Missing API Key?)."; }
    if (!question || question.trim() === '') { return "Error: Cannot generate claim for empty question."; }
    if (!knowledgeBaseCid || knowledgeBaseCid.trim() === '') { return "Error: Missing knowledgeBaseCid for claim generation."; }

    const agentType = "ClaimGen";
    await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;

    console.log(`${logPrefix} Fetching content for claim generation (CID: ${knowledgeBaseCid.substring(0, 10)}...)`);
    const paperContent = await fetchContentByCid(knowledgeBaseCid);
    if (!paperContent) {
        console.error(`${logPrefix} Failed to fetch content from CID ${knowledgeBaseCid.substring(0, 10)}...`);
        return `Error: Could not fetch knowledge base content (CID: ${knowledgeBaseCid.substring(0, 10)}...).`;
    }
    console.log(`${logPrefix} Content fetched. Requesting CLAIM generation...`);

    const systemPrompt =
        'Based *only* on the following TEXT EXCERPT, provide a concise, verifiable factual claim that directly answers the QUESTION. Output *only* the claim itself, without any preamble like "CLAIM:". If the text does not contain information to answer the question, state "Information not found in text.".';
    const truncatedContent = truncateText(paperContent, 3500);
    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nCLAIM:`;

    const payload = {
        model: MODEL_IDENTIFIER,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: MAX_TOKENS_CLAIM,
        temperature: TEMPERATURE_CLAIM,
        top_p: 0.9,
    };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': `http://localhost:${config.port || 3001}`, 'X-Title': 'Kintask ClaimGen', },
            timeout: 60000
        });
        console.log(`${logPrefix} Claim Gen API Call Successful | Status: ${response.status}`);
        const claim = response.data?.choices?.[0]?.message?.content?.trim();
        if (!claim) { throw new Error("LLM returned empty claim content."); }
        console.log(`${logPrefix} Generated Claim: "${truncateText(claim, 100)}"`);
        return claim;
    } catch (error: any) {
        const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message.split('\n')[0]; let statusCode: number | string = axiosError.code || 'N/A';
        console.error(`\n--- ERROR in generateClaim (${logPrefix}) ---`);
        // Add more detailed error logging if needed here
        console.error(`[...] Final Error generating claim: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
        return `Error: Could not generate claim (${detailedErrorMessage.substring(0, 50)}...).`;
    }
}

// ==== ./src/services/generatorService.ts ====