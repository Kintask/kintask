// src/services/generatorService.ts
import axios, { AxiosError } from 'axios';
import config from '../config';
import { truncateText } from '../utils';
import { fetchContentByCid } from './filecoinService';
// Import specific types needed and re-export LLMVerificationResult AND LLMEvaluationResult
import {
    LLMVerificationResult as LLMVerificationResultType,
    LLMEvaluationResult as LLMEvaluationResultType
} from '../types';
export { LLMVerificationResultType as LLMVerificationResult }; // Re-export with original name for verifierService
export { LLMEvaluationResultType as LLMEvaluationResult }; // Re-export evaluation type for evaluationPayoutService

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
const MAX_TOKENS_EVALUATE = 50;
const TEMPERATURE_EVALUATE = 0.2;

let isGeneratorInitialized = false;

/** Initializes the generator service, checks API key. */
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

/** Simple rate limiter middleware function. Waits if request limit is hit. */
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

initializeGenerator(); // Call initialization


/** Generates a direct answer to the question based on the provided content. */
export async function generateAnswerFromContent( // Ensure EXPORT keyword is present
    question: string,
    paperContent: string,
    requestContext?: string
): Promise<string> {
    if (!isGeneratorInitialized) { return "Error: Generator service not initialized (Missing API Key?)."; }
    if (!question || question.trim() === '') { return "Error: Cannot generate answer for empty question."; }
    if (!paperContent || paperContent.trim() === '') { return "Error: Cannot generate answer from empty content."; }

    const agentType = "AnsweringAgent";
    await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting ANSWER generation...`);

    const systemPrompt =
        `You are an AI assistant answering questions based *strictly* on the provided text excerpt.
Read the TEXT EXCERPT below and answer the QUESTION that follows.
Provide a clear and concise answer based *only* on the information present in the text.
If the information is not present in the text, state "Based on the provided text, the information is not available.".
Do not add any explanation or commentary beyond the direct answer.`;

    const truncatedContent = truncateText(paperContent, 4000);
    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nANSWER:`;
    const payload = { model: MODEL_IDENTIFIER, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: MAX_TOKENS_ANSWER, temperature: TEMPERATURE_ANSWER, top_p: 0.9 };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': `http://localhost:${config.port || 3001}`, 'X-Title': 'Kintask AnswerGen', }, timeout: 90000 });
        console.log(`${logPrefix} Answer Gen API Call Successful | Status: ${response.status}`);
        const answer = response.data?.choices?.[0]?.message?.content?.trim();
        if (!answer) { throw new Error("LLM returned empty answer content."); }
        console.log(`${logPrefix} Generated Answer: "${truncateText(answer, 150)}"`);
        return answer;
    } catch (error: any) {
        const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message.split('\n')[0]; let statusCode: number | string = axiosError.code || 'N/A';
        console.error(`\n--- ERROR in generateAnswerFromContent (${logPrefix}) ---`);
        if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] API Call FAILED | Status: ${statusCode}`); console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`; }
        else if (axiosError.request) { console.error(`[...] Network Error | Status: ${statusCode} | Request timed out or no response received.`); detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`; }
        else { console.error(`[...] Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); }
        console.error(`[...] Final Error generating answer: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
        return `Error: Could not generate answer (${detailedErrorMessage.substring(0, 50)}...).`;
    }
}


/** Uses LLM to verify if a given claim is supported by the provided text excerpt. */
export async function getVerificationFromLLM( // Exported for potential use
    claim: string,
    paperExcerpt: string,
    requestContext?: string,
    agentId?: string
): Promise<LLMVerificationResultType> { // Use imported type alias
    if (!isGeneratorInitialized) { return { verdict: 'Neutral', confidence: 0.1, explanation: "Verifier LLM misconfigured (API Key missing?)." }; }
    if (!claim || !paperExcerpt) { return { verdict: 'Neutral', confidence: 0.1, explanation: "Missing input for verification." }; }

    const agentType = agentId || "VerificationAgent";
    await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting LLM verification for claim...`);

    const systemPrompt = `You are an AI evaluating claims against a text excerpt. Analyze the TEXT EXCERPT to determine if it supports, contradicts, or is neutral towards the CLAIM. Respond ONLY in the format:\nVerdict: [Supported|Contradicted|Neutral]\nConfidence: [0.0-1.0]\nExplanation: [1 sentence concisely explaining the reasoning based *only* on the text.]`;
    const truncatedExcerpt = truncateText(paperExcerpt, 3500);
    const userPrompt = `CLAIM: "${claim}"\n\nTEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\nBased *only* on the TEXT EXCERPT, evaluate the CLAIM.`;
    const payload = { model: MODEL_IDENTIFIER, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: MAX_TOKENS_VERIFY, temperature: TEMPERATURE_VERIFY };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': `http://localhost:${config.port || 3001}`, 'X-Title': 'Kintask VerifierLLM', }, timeout: 60000 });
        console.log(`${logPrefix} Verify LLM API Call Successful | Status: ${response.status}`);
        const content = response.data?.choices?.[0]?.message?.content?.trim();
        if (!content) { throw new Error("LLM Verifier returned empty content."); }
        // --- Parsing Logic ---
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
        if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] API Call FAILED | Status: ${statusCode}`); console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`; }
        else if (axiosError.request) { console.error(`[...] Network Error | Status: ${statusCode}`); detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`; }
        else { console.error(`[...] Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); }
        console.error(`[...] Final Error for LLM call: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
        return { verdict: 'Neutral', confidence: 0.1, explanation: `LLM API Error: ${detailedErrorMessage}` };
    }
}


// --- Function to evaluate an answer using LLM ---
/** Uses LLM to evaluate if an answer correctly addresses a question based on provided text. */
export async function evaluateAnswerWithLLM( // Ensure EXPORT keyword is present
    question: string,
    answer: string,
    knowledgeBaseExcerpt: string,
    requestContext?: string,
    agentId?: string
): Promise<LLMEvaluationResultType> { // Use imported specific return type
    if (!isGeneratorInitialized) { return { evaluation: 'Uncertain', confidence: 0.1, explanation: "Evaluator LLM misconfigured." }; }
    if (!question || !answer || !knowledgeBaseExcerpt) { return { evaluation: 'Uncertain', confidence: 0.1, explanation: "Missing input for evaluation." }; }

    const agentType = agentId || "EvaluationAgent";
    await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting LLM evaluation for answer...`);

    const systemPrompt = `You are an AI judge evaluating an ANSWER based *only* on how well it answers the QUESTION using information from the TEXT EXCERPT.
Determine if the ANSWER is:
- Correct: Accurately and relevantly answers the QUESTION using *only* information found in the TEXT EXCERPT.
- Incorrect: Contains information not supported by the TEXT EXCERPT, misinterprets the text, or fails to answer the QUESTION directly.
- Uncertain: The text doesn't contain enough information to definitively judge the answer's correctness relative to the QUESTION.

Respond ONLY in the format:
Evaluation: [Correct|Incorrect|Uncertain]
Confidence: [0.0-1.0]
Explanation: [1 sentence explaining your evaluation based *only* on the text.]`;

    const truncatedExcerpt = truncateText(knowledgeBaseExcerpt, 3500);
    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\n\nQUESTION: "${question}"\n\nANSWER TO EVALUATE: "${answer}"\n\nEvaluation:`;
    const payload = { model: MODEL_IDENTIFIER, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: MAX_TOKENS_EVALUATE, temperature: TEMPERATURE_EVALUATE };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': `http://localhost:${config.port || 3001}`, 'X-Title': 'Kintask EvaluatorLLM', }, timeout: 60000 });
        console.log(`${logPrefix} Evaluation LLM Call Successful | Status: ${response.status}`);
        const content = response.data?.choices?.[0]?.message?.content?.trim();
        if (!content) { throw new Error("Evaluation LLM returned empty content."); }
        // --- Parsing Logic ---
        let evaluation: 'Correct' | 'Incorrect' | 'Uncertain' = 'Uncertain'; let confidence = 0.5; let explanation = "Could not parse evaluation response.";
        const evalMatch = content.match(/Evaluation:\s*(Correct|Incorrect|Uncertain)/i); const confMatch = content.match(/Confidence:\s*([0-9.]+)/i); const explMatch = content.match(/Explanation:\s*(.*)/i);
        if (evalMatch?.[1]) { const ev = evalMatch[1].charAt(0).toUpperCase() + evalMatch[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') { evaluation = ev; } }
        if (confMatch?.[1]) { const pc = parseFloat(confMatch[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) { confidence = pc; } }
        if (explMatch?.[1]) { explanation = explMatch[1].trim(); }
        console.log(`${logPrefix} Evaluation Result: ${evaluation} (Conf: ${confidence.toFixed(2)})`);
        // Return object matching LLMEvaluationResult type
        return { evaluation, confidence: parseFloat(confidence.toFixed(2)), explanation };
    } catch (error: any) {
        const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message.split('\n')[0]; let statusCode: number | string = axiosError.code || 'N/A';
        console.error(`\n--- ERROR in evaluateAnswerWithLLM (${logPrefix}) ---`);
        if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] API Call FAILED | Status: ${statusCode}`); console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`; }
        else if (axiosError.request) { console.error(`[...] Network Error | Status: ${statusCode}`); detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`; }
        else { console.error(`[...] Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); }
        console.error(`[...] Final Error evaluating answer: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
        return { evaluation: 'Uncertain', confidence: 0.1, explanation: `LLM API Error during evaluation: ${detailedErrorMessage}` };
    }
}


// --- generateClaim function ---
// Keep EXPORTED only if the synchronous /verify endpoint still uses it.
export async function generateClaim( // Ensure EXPORT keyword is present if needed
    question: string,
    knowledgeBaseCid: string,
    requestContext?: string
): Promise<string> {
    if (!isGeneratorInitialized) { return "Error: Generator service not initialized (Missing API Key?)."; }
    if (!question || !knowledgeBaseCid) { return "Error: Missing question or CID for claim generation."; }

    const agentType = "ClaimGen";
    await waitForRateLimit(requestContext, agentType);
    const logPrefix = `[Generator Service - ${agentType} | ${requestContext?.substring(0, 10)}...]`;

    console.log(`${logPrefix} Fetching content for claim generation (CID: ${knowledgeBaseCid.substring(0, 10)}...)`);
    const paperContent = await fetchContentByCid(knowledgeBaseCid);
    if (!paperContent) { return `Error: Could not fetch knowledge base content (CID: ${knowledgeBaseCid.substring(0, 10)}...).`; }
    console.log(`${logPrefix} Content fetched. Requesting CLAIM generation...`);

    const systemPrompt = 'Based *only* on the following TEXT EXCERPT, provide a concise, verifiable factual claim...'; // Keep prompt
    const truncatedContent = truncateText(paperContent, 3500);
    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nCLAIM:`;
    const payload = { model: MODEL_IDENTIFIER, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: MAX_TOKENS_CLAIM, temperature: TEMPERATURE_CLAIM };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': `http://localhost:${config.port || 3001}`, 'X-Title': 'Kintask ClaimGen', }, timeout: 60000 });
        console.log(`${logPrefix} Claim Gen API Call Successful | Status: ${response.status}`);
        const claim = response.data?.choices?.[0]?.message?.content?.trim();
        if (!claim) { throw new Error("LLM returned empty claim content."); }
        console.log(`${logPrefix} Generated Claim: "${truncateText(claim, 100)}"`);
        return claim;   
    } catch (error: any) {
        const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message.split('\n')[0]; let statusCode: number | string = axiosError.code || 'N/A';
        console.error(`\n--- ERROR in generateClaim (${logPrefix}) ---`);
        if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] API Call FAILED | Status: ${statusCode}`); console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`; }
        else if (axiosError.request) { console.error(`[...] Network Error | Status: ${statusCode}`); detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`; }
        else { console.error(`[...] Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); }
        console.error(`[...] Final Error generating claim: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
        return `Error: Could not generate claim (${detailedErrorMessage.substring(0, 50)}...).`;
    }
}

// ==== ./src/services/generatorService.ts ====