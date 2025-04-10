// packages/backend/src/services/generatorService.ts
import axios, { AxiosError } from 'axios';
import config from '../config';
import { truncateText } from '../utils';
import { fetchContentByCid } from './filecoinService';
import { LLMVerificationResult as LLMVerificationResultType, LLMEvaluationResult as LLMEvaluationResultType } from '../types';

// --- Conditional Service Imports ---
let localLlmService: any = null;
let nillionService: any = null;

// Import Local LLM Service if configured
if (config.llmProvider === 'local') {
    try {
        const localLlmServicePath = require.resolve('./generationLLMLocal');
        localLlmService = require(localLlmServicePath);
        if (typeof localLlmService?.generateAnswerFromContentLocal !== 'function' || typeof localLlmService?.evaluateAnswerWithLLMLocal !== 'function') {
            throw new Error("Imported localLlmService invalid.");
        }
        console.log("[Generator Service] Local LLM Service imported.");
    } catch (err: any) {
        console.error("[Generator Service] ERROR: Import local LLM service failed.", err.message);
        localLlmService = null;
    }
}

// Import Nillion Service if configured
if (config.llmProvider === 'nillion') {
    try {
        const nillionServicePath = require.resolve('./nillionSecretLLMService');
        nillionService = require(nillionServicePath);
        if (typeof nillionService?.runNillionChatCompletion !== 'function') {
            throw new Error("Imported nillionService invalid.");
        }
        console.log("[Generator Service] Nillion Service imported.");
    } catch (err: any) {
        console.error("[Generator Service] ERROR: Import nillionService failed.", err.message);
        nillionService = null;
    }
}

// Export types
export { LLMVerificationResultType as LLMVerificationResult };
export { LLMEvaluationResultType as LLMEvaluationResult };

// --- OpenRouter Specific Config ---
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = config.openRouterApiKey;

// Rate Limiting
const RATE_LIMIT_WINDOW_MS = 60 * 1000; const MAX_REQUESTS_PER_WINDOW = 10; const RATE_LIMIT_RETRY_DELAY_MS = 15000; let requestTimestamps: number[] = [];

// LLM Task Parameters
const MAX_TOKENS_ANSWER = 250; const TEMPERATURE_ANSWER = 0.5;
const MAX_TOKENS_CLAIM = 100; const TEMPERATURE_CLAIM = 0.4;
const MAX_TOKENS_VERIFY = 60; const TEMPERATURE_VERIFY = 0.2;
const MAX_TOKENS_EVALUATE = 80; const TEMPERATURE_EVALUATE = 0.1;

let isGeneratorInitialized = false;
let currentModelId: string | undefined;

/** Initializes the generator service based on selected provider */
function initializeGenerator(): void {
    if (isGeneratorInitialized) return;
    console.log(`[Generator Service] Initializing LLM config provider: ${config.llmProvider}...`);
    currentModelId = config.llmModelIdentifier;

    switch (config.llmProvider) {
        case 'local':
            if (!localLlmService) { console.error("[Generator Service] ERROR: 'local' provider selected but service failed import."); isGeneratorInitialized = false; return; }
            console.log(`[Generator Service] Provider: Local LLM`);
            if (!currentModelId) console.log(`[Generator Service] Model ID not set, using default in local service.`);
            break;
        case 'nillion':
            if (!nillionService) { console.error("[Generator Service] ERROR: 'nillion' provider selected but service failed import."); isGeneratorInitialized = false; return; }
            // *** Use correct config property names for Nillion check ***
            if (!config.nilaiApiKey || !config.nilaiApiUrl) { console.error("[Generator Service] ERROR: Nillion provider requires NILAI_API_KEY and NILAI_API_URL."); isGeneratorInitialized = false; return; }
            if (!currentModelId) currentModelId = "meta-llama/Llama-3.1-8B-Instruct";
            console.log(`[Generator Service] Provider: Nillion`); console.log(`[Generator Service] Using Nillion Model: ${currentModelId}`);
            break;
        case 'openrouter': default:
            if (!OPENROUTER_API_KEY) { console.error("[Generator Service] ERROR: 'openrouter' provider but OPENROUTER_API_KEY missing."); isGeneratorInitialized = false; return; }
            if (!currentModelId) currentModelId = "mistralai/mistral-7b-instruct:free";
            console.log(`[Generator Service] Provider: OpenRouter`); console.log(`[Generator Service] Using OpenRouter Model: ${currentModelId}`);
            break;
    }
    isGeneratorInitialized = true; console.log("[Generator Service] Initialization check complete.");
}

/** Rate limiter */
async function waitForRateLimit(context?: string, agentType?: string): Promise<void> { const now = Date.now(); requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS); const id = agentType || `Generic`; const prefix = `[RateLimit|${id}|${context?.substring(0, 6)}]`; while (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) { console.warn(`${prefix} Limit hit (${requestTimestamps.length}/${MAX_REQUESTS_PER_WINDOW}). Wait ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s`); await new Promise(r => setTimeout(r, RATE_LIMIT_RETRY_DELAY_MS)); const ct = Date.now(); requestTimestamps = requestTimestamps.filter(ts => ct - ts < RATE_LIMIT_WINDOW_MS); } requestTimestamps.push(now); }

initializeGenerator();

/** Unified error logging */
function logLLMError(error: any, functionName: string, providerName: string, logPrefix: string): string { /* ... no change ... */ const axiosError = error as AxiosError; let detailedErrorMessage = axiosError.message?.split('\n')[0] || String(error); let statusCode: number | string = axiosError.code || 'N/A'; console.error(`\n--- ERROR in ${functionName} (${logPrefix}) [Provider: ${providerName}] ---`); if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] API Call FAILED | Status: ${statusCode}`); console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || (axiosError.response.data as any)?.error || `HTTP Error ${statusCode}`; } else if (axiosError.request) { console.error(`[...] Network Error | Status: ${statusCode}`); detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`; } else if (!error?.response && error?.message) { detailedErrorMessage = error.message; console.error(`[...] Logic/Response Error: ${detailedErrorMessage}`); } else { console.error(`[...] Setup/Unknown Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); } console.error(`[...] Final Error Logged: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`); return detailedErrorMessage; }
/** Check if response data contains an error object */
function responseHasError(responseData: any): string | null { /* ... no change ... */ if (responseData?.error) { if (typeof responseData.error === 'string') return responseData.error; if (typeof responseData.error.message === 'string') return responseData.error.message; return JSON.stringify(responseData.error); } return null; }
/** Parses answer from OpenAI compatible response data */
function parseAnswerFromResult(responseData: any, logPrefix: string): string | undefined { /* ... no change ... */ let answer: string | undefined; try { const bodyError = responseHasError(responseData); if (bodyError) { console.warn(`${logPrefix} LLM response body contained error: ${bodyError}`); return undefined; } answer = responseData?.choices?.[0]?.message?.content?.trim(); } catch (parseError: any) { console.error(`${logPrefix} Error parsing LLM response structure: ${parseError.message}.`); return undefined; } if (!answer) { console.warn(`${logPrefix} LLM returned empty/unexpected answer structure.`); return undefined; } return answer; }


// ====================================================================
// Public Functions - Dispatch based on config.llmProvider
// ====================================================================

export async function generateAnswerFromContent(question: string, paperContent: string, requestContext?: string): Promise<string> {
    if (!isGeneratorInitialized) return "Error: Generator service not initialized.";

    const agentType = "AnsweringAgent";
    const logPrefix = `[GenSvc Answer|${config.llmProvider}|${requestContext?.substring(0, 6)}]`;

    await waitForRateLimit(requestContext, agentType);
    console.log(`${logPrefix} Requesting ANSWER generation...`);

    try {
        switch (config.llmProvider) {
            case 'local':
                if (!localLlmService) throw new Error("Local LLM service not available.");
                return await localLlmService.generateAnswerFromContentLocal(question, paperContent, requestContext);

            case 'nillion':
                if (!nillionService) throw new Error("Nillion service not available.");
                const messages: Array<{ role: string; content: string }> = [{ role: "system", content: `You are an AI assistant... TEXT EXCERPT:\n---\n${truncateText(paperContent, 4000)}\n---` }, { role: "user", content: `QUESTION: "${question}"\n\nANSWER:` }];
                // *** Use correct config property name ***
                const nillionResult = await nillionService.runNillionChatCompletion(messages, { model: currentModelId, temperature: TEMPERATURE_ANSWER });
                const nillionError = responseHasError(nillionResult); if (nillionError) throw new Error(`Nillion error: ${nillionError}`);
                const nillionAnswer = parseAnswerFromResult(nillionResult, logPrefix);
                if (!nillionAnswer) throw new Error("Nillion returned unparseable answer.");
                console.log(`${logPrefix} Generated Answer (Nillion): "${truncateText(nillionAnswer, 150)}"`);
                return nillionAnswer;

            case 'openrouter': default:
                if (!OPENROUTER_API_KEY || !currentModelId) throw new Error("OpenRouter config missing.");
                const systemPromptOR = `You are an AI assistant... If info not present, say so...`; const truncatedContentOR = truncateText(paperContent, 4000); const userPromptOR = `TEXT EXCERPT:\n---\n${truncatedContentOR}\n---\n\nQUESTION: "${question}"\n\nANSWER:`; const payloadOR = { model: currentModelId, messages: [{ role: "system", content: systemPromptOR }, { role: "user", content: userPromptOR }], max_tokens: MAX_TOKENS_ANSWER, temperature: TEMPERATURE_ANSWER };
                const responseOR = await axios.post(OPENROUTER_API_URL, payloadOR, { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }, timeout: 90000 });
                console.log(`${logPrefix} OpenRouter API OK | Status: ${responseOR.status}`); const answerOR = parseAnswerFromResult(responseOR.data, logPrefix); if (!answerOR) throw new Error("OpenRouter empty answer."); console.log(`${logPrefix} Generated Answer (OpenRouter): "${truncateText(answerOR, 150)}"`); return answerOR;
        }
    } catch (error: any) {
        const errorReason = logLLMError(error, `generateAnswerFromContent`, config.llmProvider || 'unknown', logPrefix);
        return `Error: Could not generate answer via ${config.llmProvider} (${truncateText(errorReason, 50)}...).`;
    }
}


export async function evaluateAnswerWithLLM(question: string, answer: string, knowledgeBaseExcerpt: string, requestContext?: string, agentId?: string): Promise<LLMEvaluationResultType> {
    if (!isGeneratorInitialized) return { evaluation: 'Uncertain', confidence: 0.1, explanation: "Generator service not initialized." };

    const agentType = agentId || "EvaluationAgent";
    const logPrefix = `[GenSvc Eval|${config.llmProvider}|${requestContext?.substring(0, 6)}]`;

    await waitForRateLimit(requestContext, agentType);
    console.log(`${logPrefix} Requesting LLM evaluation...`);

    try {
        switch (config.llmProvider) {
            case 'local':
                if (!localLlmService) throw new Error("Local LLM service not available.");
                return await localLlmService.evaluateAnswerWithLLMLocal(question, answer, knowledgeBaseExcerpt, requestContext, agentId);

            case 'nillion':
                if (!nillionService) throw new Error("Nillion service not available.");
                const truncatedExcerptN = truncateText(knowledgeBaseExcerpt, 3500); const systemPromptN = `You are an AI judge... Respond ONLY format:\nEvaluation: [Correct|Incorrect|Uncertain]\nConfidence: [0.0-1.0]\nExplanation: [...]`; const userPromptN = `TEXT EXCERPT:\n---\n${truncatedExcerptN}\n---\n\nQUESTION: "${question}"\n\nANSWER TO EVALUATE: "${answer}"\n\nEvaluation:`; const messagesN = [{ role: "system", content: systemPromptN }, { role: "user", content: userPromptN }];
                // *** Use correct config property name ***
                const nillionResult = await nillionService.runNillionChatCompletion(messagesN, { model: currentModelId, temperature: TEMPERATURE_EVALUATE });
                const nillionError = responseHasError(nillionResult); if (nillionError) throw new Error(`Nillion error: ${nillionError}`);
                const rawContentN = parseAnswerFromResult(nillionResult, logPrefix); if (!rawContentN) throw new Error("Nillion empty evaluation.");
                console.log(`${logPrefix} Raw LLM Eval Resp (Nillion):\n---\n${rawContentN}\n---`);
                let evaluationN: 'Correct' | 'Incorrect' | 'Uncertain' = 'Uncertain'; let confidenceN = 0.5; let explanationN = "Parsing failed."; try { /* ... parsing logic ... */ const eM = rawContentN.match(/^E.*:\s*(C.*|I.*|U.*)/im); const cM = rawContentN.match(/^C.*:\s*([0-9.]+)/im); const xM = rawContentN.match(/^E.*:\s*(.*)/im); if (eM?.[1]) { const ev = eM[1].charAt(0).toUpperCase() + eM[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') evaluationN = ev; } else { const fWM = rawContentN.match(/^(C.*|I.*|U.*)/i); if (fWM?.[1]) { const ev = fWM[1].charAt(0).toUpperCase() + fWM[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') evaluationN = ev; } } if (cM?.[1]) { const pc = parseFloat(cM[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) confidenceN = pc; } if (xM?.[1]) { explanationN = xM[1].trim(); } else { const l = rawContentN.split('\n'); if (l.length > 1) explanationN = l.slice(l.findIndex(ln => ln.toLowerCase().startsWith('explanation:')) + 1).join(' ').trim() || l.slice(1).join(' ').trim() || rawContentN; } } catch (pE) { explanationN = rawContentN; }
                console.log(`${logPrefix} Final Eval (Nillion): { evaluation: ${evaluationN}, confidence: ${confidenceN.toFixed(2)} }`);
                return { evaluation: evaluationN, confidence: parseFloat(confidenceN.toFixed(2)), explanation: explanationN };

            case 'openrouter': default:
                if (!OPENROUTER_API_KEY || !currentModelId) throw new Error("OpenRouter config missing.");
                const truncatedExcerptOR = truncateText(knowledgeBaseExcerpt, 3500); const systemPromptOR = `You are an AI judge... Respond ONLY format:\nEvaluation: [Correct|Incorrect|Uncertain]\nConfidence: [0.0-1.0]\nExplanation: [...]`; const userPromptOR = `TEXT EXCERPT:\n---\n${truncatedExcerptOR}\n---\n\nQUESTION: "${question}"\n\nANSWER TO EVALUATE: "${answer}"\n\nEvaluation:`; const payloadOR = { model: currentModelId, messages: [{ role: "system", content: systemPromptOR }, { role: "user", content: userPromptOR }], max_tokens: MAX_TOKENS_EVALUATE, temperature: TEMPERATURE_EVALUATE };
                const responseOR = await axios.post(OPENROUTER_API_URL, payloadOR, { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }, timeout: 60000 });
                console.log(`${logPrefix} OpenRouter Eval OK | Status: ${responseOR.status}`); const rawContentOR = parseAnswerFromResult(responseOR.data, logPrefix); if (!rawContentOR) { throw new Error("OpenRouter empty evaluation."); }
                console.log(`${logPrefix} Raw LLM Eval Resp (OpenRouter):\n---\n${rawContentOR}\n---`);
                let evaluationOR: 'Correct' | 'Incorrect' | 'Uncertain' = 'Uncertain'; let confidenceOR = 0.5; let explanationOR = "Parsing failed."; try { /* ... parsing logic ... */ const eM = rawContentOR.match(/^E.*:\s*(C.*|I.*|U.*)/im); const cM = rawContentOR.match(/^C.*:\s*([0-9.]+)/im); const xM = rawContentOR.match(/^E.*:\s*(.*)/im); if (eM?.[1]) { const ev = eM[1].charAt(0).toUpperCase() + eM[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') evaluationOR = ev; } else { const fWM = rawContentOR.match(/^(C.*|I.*|U.*)/i); if (fWM?.[1]) { const ev = fWM[1].charAt(0).toUpperCase() + fWM[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') evaluationOR = ev; } } if (cM?.[1]) { const pc = parseFloat(cM[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) confidenceOR = pc; } if (xM?.[1]) { explanationOR = xM[1].trim(); } else { const l = rawContentOR.split('\n'); if (l.length > 1) explanationOR = l.slice(l.findIndex(ln => ln.toLowerCase().startsWith('explanation:')) + 1).join(' ').trim() || l.slice(1).join(' ').trim() || rawContentOR; } } catch (pE) { explanationOR = rawContentOR; }
                console.log(`${logPrefix} Final Eval (OpenRouter): { evaluation: ${evaluationOR}, confidence: ${confidenceOR.toFixed(2)} }`);
                return { evaluation: evaluationOR, confidence: parseFloat(confidenceOR.toFixed(2)), explanation: explanationOR };
        }
    } catch (error: any) {
        const errorReason = logLLMError(error, `evaluateAnswerWithLLM`, config.llmProvider || 'unknown', logPrefix);
        return { evaluation: 'Uncertain', confidence: 0.1, explanation: `LLM API Error: ${errorReason}` };
    }
}

// Keep other functions using default (OpenRouter) or adapt if needed
export async function getVerificationFromLLM(claim: string, paperExcerpt: string, requestContext?: string, agentId?: string): Promise<LLMVerificationResultType> { /* ... unchanged OpenRouter logic ... */ if (!isGeneratorInitialized || !OPENROUTER_API_KEY || !currentModelId) return { verdict: 'Neutral', confidence: 0.1, explanation: "Verifier service not initialized." }; if (!claim || !paperExcerpt) return { verdict: 'Neutral', confidence: 0.1, explanation: "Missing input." }; const agentType = agentId || "VerificationAgent"; await waitForRateLimit(requestContext, agentType); const logPrefix = `[GenSvc Verify|OpenRouter|${requestContext?.substring(0, 6)}]`; console.log(`${logPrefix} Requesting verification...`); const truncatedExcerpt = truncateText(paperExcerpt, 3500); const systemPrompt = `You are AI evaluating claims... Respond ONLY format:\nVerdict: [Supported|Contradicted|Neutral]\nConfidence: [0.0-1.0]\nExplanation: [...]`; const userPrompt = `CLAIM: "${claim}"\n\nTEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\nEvaluate the CLAIM.`; const payload = { model: currentModelId, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: MAX_TOKENS_VERIFY, temperature: TEMPERATURE_VERIFY }; try { const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }, timeout: 60000 }); console.log(`${logPrefix} Verify API OK | Status: ${response.status}`); const rawContent = parseAnswerFromResult(response.data, logPrefix); if (!rawContent) throw new Error(`Verifier empty content.`); console.log(`${logPrefix} Raw Verify Resp:\n---\n${rawContent}\n---`); let verdict: 'Supported' | 'Contradicted' | 'Neutral' = 'Neutral'; let confidence = 0.5; let explanation = "Parsing failed."; try { /* ... parsing ... */ const vM = rawContent.match(/^V.*:\s*(S.*|C.*|N.*)/im); const cM = rawContent.match(/^C.*:\s*([0-9.]+)/im); const xM = rawContent.match(/^E.*:\s*(.*)/im); if (vM?.[1]) { const v = vM[1].charAt(0).toUpperCase() + vM[1].slice(1).toLowerCase(); if (v === 'Supported' || v === 'Contradicted' || v === 'Neutral') verdict = v; } if (cM?.[1]) { const pc = parseFloat(cM[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) confidence = pc; } if (xM?.[1]) { explanation = xM[1].trim(); } else { explanation = rawContent; } } catch (pE) { explanation = rawContent; } console.log(`${logPrefix} Result: ${verdict} (Conf: ${confidence.toFixed(2)})`); return { verdict, confidence: parseFloat(confidence.toFixed(2)), explanation }; } catch (error: any) { const errorReason = logLLMError(error, `getVerificationFromLLM`, 'OpenRouter', logPrefix); return { verdict: 'Neutral', confidence: 0.1, explanation: `API Error: ${errorReason}` }; } }
export async function generateClaim(question: string, knowledgeBaseCid: string, requestContext?: string): Promise<string> { /* ... unchanged OpenRouter logic ... */ if (!isGeneratorInitialized || !OPENROUTER_API_KEY || !currentModelId) return "Error: Claim Generator not initialized."; if (!question || !knowledgeBaseCid) return "Error: Missing input."; const agentType = "ClaimGen"; await waitForRateLimit(requestContext, agentType); const logPrefix = `[GenSvc Claim|OpenRouter|${requestContext?.substring(0, 6)}]`; console.log(`${logPrefix} Fetching content (CID: ${knowledgeBaseCid.substring(0, 10)}...)`); const paperContent = await fetchContentByCid(knowledgeBaseCid); if (!paperContent) return `Error: Could not fetch KB content.`; console.log(`${logPrefix} Requesting CLAIM generation...`); const truncatedContent = truncateText(paperContent, 3500); const systemPrompt = `Based *only* on the TEXT EXCERPT, provide a concise, single-sentence, verifiable factual claim...`; const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nCLAIM:`; const payload = { model: currentModelId, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: MAX_TOKENS_CLAIM, temperature: TEMPERATURE_CLAIM }; try { const response = await axios.post(OPENROUTER_API_URL, payload, { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }, timeout: 60000 }); console.log(`${logPrefix} Claim Gen API OK | Status: ${response.status}`); const claim = parseAnswerFromResult(response.data, logPrefix); if (!claim) throw new Error(`ClaimGen empty content.`); console.log(`${logPrefix} Generated Claim: "${truncateText(claim, 100)}"`); return claim; } catch (error: any) { const errorReason = logLLMError(error, `generateClaim`, 'OpenRouter', logPrefix); return `Error: Could not generate claim (${truncateText(errorReason, 50)}...).`; } }

// ==== ./packages/backend/src/services/generatorService.ts ====