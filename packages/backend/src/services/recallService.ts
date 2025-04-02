import { RecallLogEntryData, RecallEventType } from '../types';
import config from '../config';
// import { RecallClient } from '@recall-network/sdk'; // HYPOTHETICAL SDK import

// --- HYPOTHETICAL Recall SDK Setup ---
let isRecallConfigured = false;
// let recallClient: RecallClient | null = null;
if (config.recallApiKey && config.recallApiEndpoint) {
     console.log("[Recall Service] Configuration found (API Key starts with: " + config.recallApiKey.substring(0,4) + ", Endpoint: " + config.recallApiEndpoint + ")");
     isRecallConfigured = true;
     // try {
     //     console.log("[Recall Service] Initializing Hypothetical SDK Client...");
     //     // recallClient = new RecallClient({ apiKey: config.recallApiKey, endpoint: config.recallApiEndpoint });
     //     console.log("[Recall Service] Hypothetical SDK Client Initialized.");
     // } catch (error) {
     //      console.error("[Recall Service] Error initializing hypothetical SDK:", error);
     //      isRecallConfigured = false; // Mark as not configured if init fails
     // }
} else {
     console.warn('[Recall Service] Recall API Key or Endpoint not configured in packages/backend/.env. Logging will be simulated in memory only.');
     isRecallConfigured = false;
}
// --- End Hypothetical Setup ---


// In-memory log store for simulation, grouped by request context
const simulatedRecallLogStore: { [context: string]: RecallLogEntryData[] } = {};
const MAX_LOG_LENGTH_PER_CONTEXT = 100; // Increase max log length slightly
const MAX_CONTEXTS_IN_MEMORY = 200; // Limit number of contexts stored

export async function logRecallEvent(
    type: RecallEventType,
    details: Record<string, any>,
    requestContext: string // Context identifier for the specific Q&A verification flow
): Promise<string | undefined> { // Returns a simulated or actual proof ID/hash

    // Basic validation
    if (!requestContext) {
         console.error("[Recall Service] Cannot log event without a requestContext.");
         return undefined;
    }

    const logEntry: RecallLogEntryData = {
        timestamp: new Date().toISOString(),
        type: type,
        details: details, // Assume details are already truncated by caller (e.g., addStep)
        requestContext: requestContext,
    };

    // --- Store in memory simulation ---
    if (!simulatedRecallLogStore[requestContext]) {
        // Evict oldest context if store is full
        if (Object.keys(simulatedRecallLogStore).length >= MAX_CONTEXTS_IN_MEMORY) {
            const oldestContext = Object.keys(simulatedRecallLogStore)[0]; // Simple FIFO eviction
            delete simulatedRecallLogStore[oldestContext];
             console.warn(`[Recall Service] In-memory log store reached max contexts (${MAX_CONTEXTS_IN_MEMORY}), evicted context: ${oldestContext}`);
        }
        simulatedRecallLogStore[requestContext] = [];
    }
    // Add to log and trim if it gets too long for this context
    simulatedRecallLogStore[requestContext].push(logEntry);
    if (simulatedRecallLogStore[requestContext].length > MAX_LOG_LENGTH_PER_CONTEXT) {
         simulatedRecallLogStore[requestContext].shift(); // Remove oldest entry for this context
    }
    // --- End In-memory simulation store ---


    // Simulate logging call and prepare simulated proof ID
    const simulatedProofId = `sim_recall_${type.toLowerCase()}_${Date.now().toString(36)}_${requestContext.slice(-6)}`;
    // Log less detail to console by default to reduce noise
    // console.log(`[Recall Service] Log [${requestContext}] Type=${type}`);


    // --- Actual SDK Call Placeholder ---
    if (!isRecallConfigured /* || !recallClient */) {
        // console.warn('[Recall Service] Actual logging skipped (client not configured/initialized).');
        return simulatedProofId; // Return simulated ID if not configured
    }

    try {
        console.log(`[Recall Service] Sending log type ${type} for context ${requestContext} to actual Recall Network...`);

        // --- Replace with actual SDK call ---
        // Example: const response = await recallClient.log(logEntry);
        // const actualProofId = response?.recordId || response?.transactionHash || simulatedProofId;
        // console.log(`[Recall Service] Event ${type} logged successfully. Actual Proof ID: ${actualProofId}`);
        // return actualProofId;
        // --- End SDK call placeholder ---

        // Simulate network latency for demo
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 20)); // 20-70ms delay
        console.log(`[Recall Service] SIMULATED successful log to Recall Network for type ${type}. Proof: ${simulatedProofId}`);

        return simulatedProofId; // Return simulated proof ID for now

    } catch (error: any) {
        console.error(`[Recall Service] Error logging event ${type} for context ${requestContext} to actual network:`, error.message);
        // Fallback to simulated ID on error? Or return undefined? Let's return undefined on actual log failure.
        return undefined; // Indicate failure to log to actual network
    }
    // --- End Placeholder ---
}

// Helper function to retrieve the simulated log trace for a specific request context
export function getSimulatedTrace(requestContext: string): RecallLogEntryData[] {
    if (!requestContext) return [];
    // Return a copy to prevent mutation
    return [...(simulatedRecallLogStore[requestContext] || [])];
}

// Optional: Function to clear old logs from memory simulation
export function clearOldSimulatedLogs(maxAgeMs: number = 60 * 60 * 1000) { // Clear logs older than 1 hour
    const now = Date.now();
    let contextsCleared = 0;
    let entriesRemoved = 0;
    for (const context in simulatedRecallLogStore) {
        const initialLength = simulatedRecallLogStore[context].length;
        simulatedRecallLogStore[context] = simulatedRecallLogStore[context].filter(
            entry => (now - new Date(entry.timestamp).getTime()) < maxAgeMs
        );
         entriesRemoved += initialLength - simulatedRecallLogStore[context].length;
        if (simulatedRecallLogStore[context].length === 0) {
            delete simulatedRecallLogStore[context];
            contextsCleared++;
        }
    }
    if (entriesRemoved > 0 || contextsCleared > 0) {
         console.log(`[Recall Service] Cleared ${entriesRemoved} old simulated log entries across ${contextsCleared} contexts.`);
    }
}

// Optional: Set interval to clear old logs periodically
// setInterval(clearOldSimulatedLogs, 15 * 60 * 1000); // Clear every 15 mins
