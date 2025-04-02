import OpenAI from 'openai';
import config from '../config';

let openai: OpenAI | null = null;
let isGeneratorInitialized = false;

function initializeGenerator() {
    if (isGeneratorInitialized) return;
    console.log("[Generator Service] Initializing...");
    try {
        if (!config.openaiApiKey) {
             throw new Error("OPENAI_API_KEY is not configured.");
        }
        openai = new OpenAI({
            apiKey: config.openaiApiKey,
            timeout: 30000, // 30 second timeout for API requests
            maxRetries: 2,
        });
        // Perform a simple test call to check API key validity? (Optional, adds startup delay)
        // e.g., openai.models.list().then(...).catch(...)
        isGeneratorInitialized = true;
        console.log("[Generator Service] OpenAI client initialization attempted.");
    } catch (error: any) {
         console.error("[Generator Service] FATAL ERROR initializing OpenAI client:", error.message);
         openai = null;
         isGeneratorInitialized = false;
         // Optional: Exit if essential? process.exit(1);
    }
}

// Initialize eagerly on module load
initializeGenerator();

export async function generateAnswer(question: string): Promise<string> {
  if (!isGeneratorInitialized || !openai) {
    console.error("[Generator Service] OpenAI client not available.");
    // Return error string that controller can detect
    return "Error: AI answer generation service is not configured or failed to initialize.";
  }
  if (!question || question.trim() === '') {
      console.warn("[Generator Service] Received empty question.");
      return "Error: Cannot generate answer for empty question.";
  }

  console.log(`[Generator Service] Requesting answer for: "${question.substring(0, 100)}..."`);
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Consider gpt-4-turbo-preview if budget allows for better reasoning
      messages: [
        { role: 'system', content: 'You are Kintask, a helpful assistant focused on providing factual information based on verifiable sources when possible. Answer the user\'s query directly and concisely. Avoid apologies or excessive hedging.' },
        { role: 'user', content: question },
      ],
      max_tokens: 200, // Limit response length
      temperature: 0.3, // More focused/deterministic
      n: 1,
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    if (!answer) {
         console.warn("[Generator Service] OpenAI returned empty answer content.");
         // Provide a slightly more specific message
         return 'Error: The AI model generated an empty response.';
    }

    console.log(`[Generator Service] Received answer (truncated): "${answer.substring(0, 100)}..."`);
    return answer;

  } catch (error: any) {
      let errorMessage = "Unknown error generating answer";
      if (error instanceof OpenAI.APIError) {
          console.error('[Generator Service] OpenAI API Error:', error.status, error.name, error.headers, error.message);
          errorMessage = `OpenAI API Error (${error.status} ${error.name}): ${error.message}`;
      } else if (error instanceof Error) {
           console.error('[Generator Service] Error fetching answer from OpenAI:', error);
           errorMessage = error.message;
      } else {
           console.error('[Generator Service] Unexpected error object:', error);
      }
    // Return user-friendly error string
    return `Error: Could not retrieve answer from the AI model (${errorMessage.substring(0, 80)}...).`;
  }
}
