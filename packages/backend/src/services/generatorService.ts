// services/generatorService.ts
import axios, { AxiosError } from 'axios';
import config from '../config';
// --- REMOVED Recall import ---
// import { logRecallEvent } from './recallService';
import { truncateText } from '../utils';

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = config.openRouterApiKey;
const MODEL_IDENTIFIER = "mistralai/mistral-7b-instruct:free";

// Rate Limiting Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds window
const MAX_REQUESTS_PER_WINDOW = 10; // Allow 10 requests per minute
const RATE_LIMIT_RETRY_DELAY_MS = 15000; // Wait 15 seconds if limit is hit
let requestTimestamps: number[] = [];

const MAX_TOKENS_CLAIM = 50;
const TEMPERATURE_CLAIM = 0.3;
const MAX_TOKENS_VERIFY = 30;
const TEMPERATURE_VERIFY = 0.1;

let isGeneratorInitialized = false;
function initializeGenerator() {
    if (isGeneratorInitialized) return;
    console.log("[Generator Service] Initializing OpenRouter configuration...");
    if (!API_KEY) { console.error("[Generator Service] FATAL ERROR: OPENROUTER_API_KEY variable is missing."); isGeneratorInitialized = false; return; }
    console.log(`[Generator Service] Using API Key starting with: ${API_KEY.substring(0, 10)}...`);
    console.log(`[Generator Service] Configured model: ${MODEL_IDENTIFIER}`);
    isGeneratorInitialized = true;
}

// Rate Limiter Function
async function waitForRateLimit(context?: string, agentId?: string): Promise<void> {
    const now = Date.now();
    requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    const identifier = agentId ? `Agent ${agentId}` : `ClaimGen`;
    const logPrefix = `[Rate Limiter - ${identifier} | Context: ${context?.substring(0, 10)}...]`;
    while (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        console.warn(`${logPrefix} Rate limit hit. Waiting ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
        const currentTime = Date.now();
        requestTimestamps = requestTimestamps.filter(ts => currentTime - ts < RATE_LIMIT_WINDOW_MS);
    }
    requestTimestamps.push(now);
}

// generateClaim function
export async function generateClaim(question: string, requestContext?: string): Promise<string> {
    if (!isGeneratorInitialized) initializeGenerator();
    if (!API_KEY || !isGeneratorInitialized) { console.error("[Generator Service] Cannot generate claim: Not configured/initialized."); return "Error: Claim generation service misconfigured."; }
    if (!question || question.trim() === '') { return "Error: Cannot generate claim for empty question."; }

    await waitForRateLimit(requestContext);
    console.log(`[Generator Service Request: ${requestContext?.substring(0, 10)}...] Requesting CLAIM generation...`);
    const systemPrompt = 'Based on the QUESTION, provide a concise, verifiable factual claim that answers the question. Output only the claim.';
    const payload = { model: MODEL_IDENTIFIER, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `QUESTION: "${question}"\n\nCLAIM:` }], max_tokens: MAX_TOKENS_CLAIM, temperature: TEMPERATURE_CLAIM, top_p: 0.9, };

    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': `http://localhost:${config.port || 3001}`, 'X-Title': 'Kintask ClaimGen', }, timeout: 60000 });
        console.log(`[Generator Service Request: ${requestContext?.substring(0, 10)}...] Claim Gen API Call Successful | Status: ${response.status}`);
        const claim = response.data?.choices?.[0]?.message?.content?.trim().replace(/^CLAIM:\s*/i, '');
        if (!claim) { throw new Error("LLM returned empty claim content."); }
        console.log(`[Generator Service Request: ${requestContext?.substring(0, 10)}...] Generated Claim: "${truncateText(claim, 70)}"`);
        // --- Recall Log REMOVED ---
        return claim;
    } catch (error: any) {
        const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message.split('\n')[0]; let statusCode: number | string = 'N/A'; console.error(`\n--- ERROR in generateClaim ---`); if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] Claim Gen API Call FAILED | Status: ${statusCode}`); console.error(`[...] Claim Gen Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`; /* ... */ } else if (axiosError.request) { console.error(`[...] Claim Gen Network Error | Status: ${statusCode}`); } else { console.error(`[...] Claim Gen Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); } console.error(`[...] Final Error generating claim: ${detailedErrorMessage}`); console.error(`--- END ERROR in generateClaim ---\n`);
        // --- Recall Log REMOVED ---
        return `Error: Could not generate claim (${detailedErrorMessage.substring(0, 50)}...).`;
    }
}

// --- LLMVerificationResult Interface ---
export interface LLMVerificationResult { verdict: 'Supported' | 'Contradicted' | 'Neutral'; confidence: number; explanation?: string; }

// --- getVerificationFromLLM ---
export async function getVerificationFromLLM(
    claim: string, paperExcerpt: string, requestContext?: string, agentId?: string
): Promise<LLMVerificationResult> {
    if (!isGeneratorInitialized) initializeGenerator();
    if (!API_KEY || !isGeneratorInitialized) { console.error(`[Verifier Agent ${agentId} Error] LLM Verifier misconfigured.`); return { verdict: 'Neutral', confidence: 0.1, explanation: "Verifier LLM misconfigured." }; }
    await waitForRateLimit(requestContext, agentId);
    console.log(`[Verifier Agent ${agentId} Request: ${requestContext?.substring(0, 10)}...] Requesting LLM verification...`);
    const systemPrompt = `You are an AI evaluating scientific claims. Analyze the TEXT EXCERPT to determine if it supports, contradicts, or is neutral towards the CLAIM. Respond ONLY in the format:\nVerdict: [Supported|Contradicted|Neutral]\nConfidence: [0.0-1.0]\nExplanation: [1 sentence]`;
    const truncatedExcerpt = truncateText(paperExcerpt, 3000);
    const userPrompt = `CLAIM: "${claim}"\n\nTEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\nBased *only* on the TEXT EXCERPT, evaluate the CLAIM.`;
    const payload = { model: MODEL_IDENTIFIER, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: MAX_TOKENS_VERIFY, temperature: TEMPERATURE_VERIFY, };
    console.log(`[Verifier Agent ${agentId} DEBUG] Attempting axios.post...`);
    try {
        const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { /* ... */ }, timeout: 45000 });
        console.log(`[Verifier Agent ${agentId} Request: ${requestContext?.substring(0, 10)}...] Verify LLM API Call Successful | Status: ${response.status}`);
        const content = response.data?.choices?.[0]?.message?.content?.trim();
        if (!content) { throw new Error("LLM Verifier returned empty content."); }
        let verdict: 'Supported' | 'Contradicted' | 'Neutral' = 'Neutral'; let confidence = 0.5; let explanation = "Could not parse."; const verdictMatch = content.match(/Verdict:\s*(Supported|Contradicted|Neutral)/i); const confidenceMatch = content.match(/Confidence:\s*([0-9.]+)/i); const explanationMatch = content.match(/Explanation:\s*(.*)/i);
        if (verdictMatch?.[1]) { const fv = verdictMatch[1].charAt(0).toUpperCase() + verdictMatch[1].slice(1).toLowerCase(); if (fv === 'Supported' || fv === 'Contradicted' || fv === 'Neutral') { verdict = fv; } }
        if (confidenceMatch?.[1]) { const pc = parseFloat(confidenceMatch[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) { confidence = pc; } }
        if (explanationMatch?.[1]) { explanation = explanationMatch[1].trim(); }
        return { verdict, confidence: parseFloat(confidence.toFixed(2)), explanation };
    } catch (error: any) {
        const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message.split('\n')[0]; let statusCode: number | string = 'N/A'; console.error(`\n--- ERROR in getVerificationFromLLM (Agent: ${agentId}) ---`); if (axiosError.response) { /* ... */ } else if (axiosError.request) { /* ... */ } else { /* ... */ } console.error(`[...] Final Error for LLM call: ${detailedErrorMessage}`); console.error(`--- END ERROR ---\n`);
        // --- Recall Log REMOVED ---
        return { verdict: 'Neutral', confidence: 0.1, explanation: `LLM API Error: ${detailedErrorMessage}` };
    }
}