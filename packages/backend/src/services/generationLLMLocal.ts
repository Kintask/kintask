// packages/backend/src/services/generationLLMLocal.ts
import axios, { AxiosError } from 'axios';
import { truncateText } from '../utils';
import { LLMVerificationResult, LLMEvaluationResult } from '../types'; // Import shared types

// --- Configuration for Local LLM Server ---
const LOCAL_LLM_API_URL = process.env.LOCAL_LLM_URL || "http://localhost:1234/v1/chat/completions";
const LOCAL_MODEL_ANSWER = process.env.LOCAL_LLM_MODEL_ANSWER || "local-model"; // Replace with your local model name if needed
const LOCAL_MODEL_EVALUATE = process.env.LOCAL_LLM_MODEL_EVALUATE || "local-model"; // Can be the same or different

// --- Constants for different LLM tasks ---
const MAX_TOKENS_ANSWER = 250;
const TEMPERATURE_ANSWER = 0.5;
const MAX_TOKENS_VERIFY = 50; // Not used here, but kept for reference
const TEMPERATURE_VERIFY = 0.2; // Not used here
const MAX_TOKENS_EVALUATE = 80; // Slightly more tokens for local model evaluation
const TEMPERATURE_EVALUATE = 0.2; // Low temp for structured output

console.log(`[LLM Local Service] Initializing...`);
console.log(`[LLM Local Service] API URL: ${LOCAL_LLM_API_URL}`);
console.log(`[LLM Local Service] Model for Answers: ${LOCAL_MODEL_ANSWER}`);
console.log(`[LLM Local Service] Model for Evaluations: ${LOCAL_MODEL_EVALUATE}`);


/**
 * Generates a direct answer using a local LLM server.
 */
export async function generateAnswerFromContentLocal(
    question: string,
    paperContent: string,
    requestContext?: string
): Promise<string> {
    const logPrefix = `[LLM Local Service - Answer | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting ANSWER generation...`);

    if (!question || !paperContent) {
        console.error(`${logPrefix} Error: Missing question or content.`);
        return "Error: Missing question or content for local generation.";
    }

    const systemPrompt =
        `You are an AI assistant answering questions based *strictly* on the provided text excerpt.
Read the TEXT EXCERPT below and answer the QUESTION that follows.
Provide a clear and concise answer based *only* on the information present in the text.
If the information is not present in the text, state "Based on the provided text, the information is not available.".
Do not add any explanation or commentary beyond the direct answer.`;

    const truncatedContent = truncateText(paperContent, 4000); // Adjust based on local model context size
    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedContent}\n---\n\nQUESTION: "${question}"\n\nANSWER:`;

    const payload = {
        model: LOCAL_MODEL_ANSWER,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: TEMPERATURE_ANSWER,
        stream: false // Ensure no streaming for simple response
        // Add other parameters like top_p if supported/needed by your local server
    };

    try {
        console.log(`${logPrefix} Sending request to ${LOCAL_LLM_API_URL}`);
        const response = await axios.post(LOCAL_LLM_API_URL, payload, {
             headers: { 'Content-Type': 'application/json' },
             timeout: 90000 // 90 second timeout
        });

        console.log(`${logPrefix} Local LLM Call Successful | Status: ${response.status}`);
        const answer = response.data?.choices?.[0]?.message?.content?.trim();

        if (!answer) {
            console.error(`${logPrefix} Error: Local LLM returned empty answer content.`);
            console.error("Raw Response:", response.data); // Log raw response on error
            throw new Error("Local LLM returned empty answer content.");
        }

        console.log(`${logPrefix} Generated Answer: "${truncateText(answer, 150)}"`);
        return answer;

    } catch (error: any) {
        const axiosError = error as AxiosError;
        let detailedErrorMessage = axiosError.message.split('\n')[0];
        let statusCode: number | string = axiosError.code || 'N/A';
        console.error(`\n--- ERROR in generateAnswerFromContentLocal (${logPrefix}) ---`);
        if (axiosError.response) {
             statusCode = axiosError.response.status;
             console.error(`[...] API Call FAILED | Status: ${statusCode}`);
             console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2));
             detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`;
        } else if (axiosError.request) {
             console.error(`[...] Network Error | Status: ${statusCode} | Is the local server running at ${LOCAL_LLM_API_URL}?`);
             detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`;
        } else {
             console.error(`[...] Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`);
        }
        console.error(`[...] Final Error generating answer: ${detailedErrorMessage}`);
        console.error(`--- END ERROR ---`);
        return `Error: Could not generate answer via local LLM (${detailedErrorMessage.substring(0, 50)}...).`;
    }
}


/**
 * Evaluates an answer using a local LLM server.
 */
export async function evaluateAnswerWithLLMLocal(
    question: string,
    answer: string,
    knowledgeBaseExcerpt: string,
    requestContext?: string,
    agentId?: string // Keep signature consistent, though agentId isn't used by local LLM directly
): Promise<LLMEvaluationResult> {
    const logPrefix = `[LLM Local Service - Evaluate | ${requestContext?.substring(0, 10)}...]`;
    console.log(`${logPrefix} Requesting LLM evaluation for answer...`);

     if (!question || !answer || !knowledgeBaseExcerpt) {
         console.error(`${logPrefix} Error: Missing question, answer, or excerpt for evaluation.`);
         return { evaluation: 'Uncertain', confidence: 0.1, explanation: "Missing input for local evaluation." };
     }

    const systemPrompt = `You are an AI judge evaluating an ANSWER based *only* on how well it answers the QUESTION using information from the TEXT EXCERPT.
Determine if the ANSWER is:
- Correct: Accurately and relevantly answers the QUESTION using *only* information found in the TEXT EXCERPT.
- Incorrect: Contains information not supported by the TEXT EXCERPT, misinterprets the text, or fails to answer the QUESTION directly.
- Uncertain: The text doesn't contain enough information to definitively judge the answer's correctness relative to the QUESTION.

Respond ONLY in the exact format below, with each field on a new line:
Evaluation: [Correct|Incorrect|Uncertain]
Confidence: [0.0-1.0]
Explanation: [1 sentence explaining your evaluation based *only* on the text.]`;

    const truncatedExcerpt = truncateText(knowledgeBaseExcerpt, 3500); // Adjust based on local model
    const userPrompt = `TEXT EXCERPT:\n---\n${truncatedExcerpt}\n---\n\nQUESTION: "${question}"\n\nANSWER TO EVALUATE: "${answer}"\n\nEvaluation:`;

    const payload = {
        model: LOCAL_MODEL_EVALUATE,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: MAX_TOKENS_EVALUATE,
        temperature: TEMPERATURE_EVALUATE,
        stream: false
    };

    try {
        console.log(`${logPrefix} Sending request to ${LOCAL_LLM_API_URL}`);
        const response = await axios.post(LOCAL_LLM_API_URL, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000 // 60 second timeout
        });

        console.log(`${logPrefix} Local LLM Eval Call Successful | Status: ${response.status}`);
        const rawContent = response.data?.choices?.[0]?.message?.content?.trim();

        if (!rawContent) {
            console.error(`${logPrefix} Error: Local LLM evaluation returned empty content.`);
            console.error("Raw Response:", response.data);
            throw new Error("Local LLM evaluation returned empty content.");
        }

        console.log(`${logPrefix} Raw LLM Evaluation Response:\n---\n${rawContent}\n---`);

        // --- Parsing Logic ---
        let evaluation: 'Correct' | 'Incorrect' | 'Uncertain' = 'Uncertain';
        let confidence = 0.5;
        let explanation = "Could not parse LLM evaluation response.";

        const evalMatch = rawContent.match(/^Evaluation:\s*(Correct|Incorrect|Uncertain)/im);
        const confMatch = rawContent.match(/^Confidence:\s*([0-9.]+)/im);
        const explMatch = rawContent.match(/^Explanation:\s*(.*)/im);

        if (evalMatch?.[1]) { const ev = evalMatch[1].charAt(0).toUpperCase() + evalMatch[1].slice(1).toLowerCase(); if (ev === 'Correct' || ev === 'Incorrect' || ev === 'Uncertain') { evaluation = ev; } }
        else { console.warn(`${logPrefix} Could not parse 'Evaluation:' line.`); }

        if (confMatch?.[1]) { const pc = parseFloat(confMatch[1]); if (!isNaN(pc) && pc >= 0 && pc <= 1) { confidence = pc; } else { console.warn(`${logPrefix} Could not parse confidence value: ${confMatch[1]}`); } }
        else { console.warn(`${logPrefix} Could not parse 'Confidence:' line.`); }

        if (explMatch?.[1]) { explanation = explMatch[1].trim(); }
        else {
            console.warn(`${logPrefix} Could not parse 'Explanation:' line. Using raw response as fallback.`);
            explanation = rawContent; // Fallback to raw content if parsing fails
        }
        // --- End Parsing Logic ---

        console.log(`${logPrefix} Parsed Evaluation Result: { evaluation: ${evaluation}, confidence: ${confidence.toFixed(2)} }`);
        return { evaluation, confidence: parseFloat(confidence.toFixed(2)), explanation };

    } catch (error: any) {
        const axiosError = error as AxiosError;
        let detailedErrorMessage = axiosError.message.split('\n')[0];
        let statusCode: number | string = axiosError.code || 'N/A';
        console.error(`\n--- ERROR in evaluateAnswerWithLLMLocal (${logPrefix}) ---`);
        if (axiosError.response) { statusCode = axiosError.response.status; console.error(`[...] API Call FAILED | Status: ${statusCode}`); console.error(`[...] Error Response Data:`, JSON.stringify(axiosError.response.data, null, 2)); detailedErrorMessage = (axiosError.response.data as any)?.error?.message || `HTTP Error ${statusCode}`; }
        else if (axiosError.request) { console.error(`[...] Network Error | Status: ${statusCode} | Is the local server running at ${LOCAL_LLM_API_URL}?`); detailedErrorMessage = `Network Error: ${axiosError.code || 'No response'}`; }
        else { console.error(`[...] Setup Error | Status: ${statusCode} | Msg: ${detailedErrorMessage}`); }
        console.error(`[...] Final Error evaluating answer: ${detailedErrorMessage}`); console.error(`--- END ERROR ---`);
        return { evaluation: 'Uncertain', confidence: 0.1, explanation: `Local LLM API Error during evaluation: ${detailedErrorMessage}` };
    }
}

// NOTE: getVerificationFromLLM (for claims) is not implemented here,
// as the primary focus was on answer generation and evaluation replacement.