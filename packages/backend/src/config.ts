// packages/backend/src/config.ts
import dotenv from 'dotenv';
import path from 'path';

const envPath = path.resolve(__dirname, '../.env');
console.log(`[Config - Backend] Attempting to load .env from: ${envPath}`);
const dotenvResult = dotenv.config({ path: envPath });

if (dotenvResult.error) { console.error(`[Config - Backend] FATAL ERROR loading .env file from ${envPath}:`, dotenvResult.error); process.exit(1); }
else if (dotenvResult.parsed) { console.log(`[Config - Backend] Successfully loaded .env file from: ${envPath}`); }
else { console.warn(`[Config - Backend] dotenv.config() finished but no variables were parsed from ${envPath}.`); }

interface AppConfig {
    port: number | string;
    recallPrivateKey?: string;
    recallLogBucket?: string;
    fvmRpcUrl?: string;
    fvmRpcFallbackUrls?: string[];
    fvmAggregatorContractAddress?: string;
    fvmAggregatorContractF4Address?: string;
    l2RpcUrl?: string;
    l2RpcFallbackUrls?: string[];
    walletPrivateKey?: string;
    kintaskContractAddress?: string;
    blocklockSenderProxyAddress?: string;
    ipfsGatewayUrl: string;
    w3upAgentEmail?: string;
    kintaskSpaceDid?: string;

    // LLM Provider Selection
    llmProvider?: 'openrouter' | 'local' | 'nillion';
    llmModelIdentifier?: string;

    // OpenRouter
    openRouterApiKey?: string;

    // Local LLM Server
    localLlmUrl?: string;
    localLlmModelAnswer?: string;
    localLlmModelEvaluate?: string;

    // Nillion - Renamed config properties to match env vars
    nillionUserId?: string;
    nillionNodeKeyPath?: string;
    nillionBootnodes?: string[];
    nillionPaymentsContractAddress?: string;
    nillionComputeActionId?: string;
    nilaiApiKey?: string; // Matches env var NILAI_API_KEY
    nilaiApiUrl?: string; // Matches env var NILAI_API_URL
}

const loadedConfig: AppConfig = {
    port: process.env.PORT || 3001,
    recallPrivateKey: process.env.RECALL_PRIVATE_KEY,
    recallLogBucket: process.env.RECALL_LOG_BUCKET,
    fvmRpcUrl: process.env.FVM_RPC_URL,
    fvmRpcFallbackUrls: process.env.FVM_RPC_FALLBACK_URLS?.split(',').map(url => url.trim()).filter(url => url) || [],
    fvmAggregatorContractAddress: process.env.FVM_AGGREGATOR_CONTRACT_ADDRESS,
    fvmAggregatorContractF4Address: process.env.FVM_AGGREGATOR_CONTRACT_F4_ADDRESS,
    l2RpcUrl: process.env.L2_RPC_URL,
    l2RpcFallbackUrls: process.env.L2_RPC_FALLBACK_URLS?.split(',').map(url => url.trim()).filter(url => url) || [],
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
    kintaskContractAddress: process.env.KINTASK_CONTRACT_ADDRESS,
    blocklockSenderProxyAddress: process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS,
    ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/',
    w3upAgentEmail: process.env.W3UP_AGENT_EMAIL,
    kintaskSpaceDid: process.env.KINTASK_SPACE_DID,

    // LLM Config Loading
    llmProvider: (process.env.LLM_PROVIDER?.toLowerCase() === 'local' ? 'local' :
        (process.env.LLM_PROVIDER?.toLowerCase() === 'nillion' ? 'nillion' : 'openrouter')) as 'openrouter' | 'local' | 'nillion' | undefined,
    llmModelIdentifier: process.env.LLM_MODEL_IDENTIFIER,

    // Provider Specific
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    localLlmUrl: process.env.LOCAL_LLM_URL,
    localLlmModelAnswer: process.env.LOCAL_LLM_MODEL_ANSWER,
    localLlmModelEvaluate: process.env.LOCAL_LLM_MODEL_EVALUATE,
    nillionUserId: process.env.NILLION_USER_ID,
    nillionNodeKeyPath: process.env.NILLION_NODE_KEY_PATH,
    nillionBootnodes: process.env.NILLION_BOOTNODES?.split(',').map(url => url.trim()).filter(url => url),
    nillionPaymentsContractAddress: process.env.NILLION_PAYMENTS_CONTRACT_ADDRESS,
    nillionComputeActionId: process.env.NILLION_COMPUTE_ACTION_ID,
    nilaiApiKey: process.env.NILAI_API_KEY, // Correct property name
    nilaiApiUrl: process.env.NILAI_API_URL,   // Correct property name
};

// --- Log Selected LLM Provider ---
console.log(`[Config - Backend] Selected LLM Provider: ${loadedConfig.llmProvider}`);
if (loadedConfig.llmProvider === 'local') console.log(`[Config - Backend] Using Local LLM URL: ${loadedConfig.localLlmUrl || 'Default in service'}`);
if (loadedConfig.llmProvider === 'nillion') console.log(`[Config - Backend] Using Nillion NIL-AI URL: ${loadedConfig.nilaiApiUrl}`); // Use correct property
if (loadedConfig.llmProvider === 'openrouter') console.log(`[Config - Backend] Using OpenRouter (API key loaded: ${!!loadedConfig.openRouterApiKey})`);
if (loadedConfig.llmModelIdentifier) console.log(`[Config - Backend] Using LLM Model: ${loadedConfig.llmModelIdentifier}`);


// --- Apply Fallbacks ---
if (!loadedConfig.l2RpcUrl && loadedConfig.fvmRpcUrl) { console.log(`[Config - Backend] Fallback: Using FVM_RPC_URL for l2RpcUrl.`); loadedConfig.l2RpcUrl = loadedConfig.fvmRpcUrl; if (loadedConfig.fvmRpcFallbackUrls?.length && !loadedConfig.l2RpcFallbackUrls?.length) { console.log(`[Config - Backend] Fallback: Using FVM_RPC_FALLBACK_URLS for l2RpcFallbackUrls.`); loadedConfig.l2RpcFallbackUrls = loadedConfig.fvmRpcFallbackUrls; } }
if (!loadedConfig.walletPrivateKey && loadedConfig.recallPrivateKey) { console.log(`[Config - Backend] Fallback: Using RECALL_PRIVATE_KEY for walletPrivateKey.`); loadedConfig.walletPrivateKey = loadedConfig.recallPrivateKey; }

loadedConfig.fvmRpcFallbackUrls = [loadedConfig.fvmRpcUrl || '', ...(loadedConfig.fvmRpcFallbackUrls || [])].filter(url => url);
loadedConfig.l2RpcFallbackUrls = [loadedConfig.l2RpcUrl || '', ...(loadedConfig.l2RpcFallbackUrls || [])].filter(url => url);


// --- Define required variables ---
type RequiredKeys = Exclude<
    keyof AppConfig,
    | 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid'
    | 'fvmAggregatorContractF4Address' | 'fvmRpcFallbackUrls' | 'l2RpcFallbackUrls'
    | 'openRouterApiKey' | 'localLlmUrl' | 'localLlmModelAnswer' | 'localLlmModelEvaluate'
    // Corrected Nillion optional keys
    | 'nillionUserId' | 'nillionNodeKeyPath' | 'nillionBootnodes' | 'nillionPaymentsContractAddress'
    | 'nillionComputeActionId' | 'nilaiApiKey' | 'nilaiApiUrl' // Now matches interface
    | 'llmModelIdentifier'
>;

const requiredConfigKeys: Array<RequiredKeys> = [
    'recallPrivateKey', 'fvmRpcUrl', 'fvmAggregatorContractAddress',
    'l2RpcUrl', 'walletPrivateKey', 'kintaskContractAddress', 'blocklockSenderProxyAddress',
    'llmProvider'
];

let missingVars = false;
console.log("[Config - Backend] Checking required configuration values...");
requiredConfigKeys.forEach((key) => { if (!(loadedConfig as any)[key]) { let detail = key.toUpperCase(); if (key === 'l2RpcUrl') detail = 'L2_RPC_URL (or FVM_RPC_URL fallback)'; if (key === 'walletPrivateKey') detail = 'WALLET_PRIVATE_KEY (or RECALL_PRIVATE_KEY fallback)'; console.error(`[Config - Backend] FATAL ERROR: Required config '${key}' missing. Env var needed: ${detail}.`); missingVars = true; } });

// Check provider-specific requirements
if (loadedConfig.llmProvider === 'openrouter' && !loadedConfig.openRouterApiKey) { console.error(`[Config - Backend] FATAL ERROR: llmProvider='openrouter' but OPENROUTER_API_KEY missing.`); missingVars = true; }
if (loadedConfig.llmProvider === 'local' && !loadedConfig.localLlmUrl) { console.warn(`[Config - Backend] Warning: llmProvider='local' but LOCAL_LLM_URL not set. Using default.`); }
// Use correct property names for Nillion check
if (loadedConfig.llmProvider === 'nillion' && (!loadedConfig.nilaiApiKey || !loadedConfig.nilaiApiUrl)) { console.error(`[Config - Backend] FATAL ERROR: llmProvider='nillion' but NILAI_API_KEY or NILAI_API_URL missing.`); missingVars = true; }


// RPC URL check
if (!loadedConfig.fvmRpcFallbackUrls?.length) { console.error(`[Config - Backend] FATAL ERROR: No FVM RPC URLs.`); missingVars = true; }
if (!loadedConfig.l2RpcFallbackUrls?.length) { console.error(`[Config - Backend] FATAL ERROR: No L2 RPC URLs.`); missingVars = true; }


if (missingVars) { console.error("\n[Config - Backend] Please configure required variables in .env and restart."); process.exit(1); }

console.log("[Config - Backend] Environment variables processed successfully.");

// --- Export the validated config ---
// Define a precise type for the exported config, including the correct Nillion keys
type FinalConfig = Readonly<
    Omit<Required<AppConfig>,
        | 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid'
        | 'fvmAggregatorContractF4Address'
        | 'openRouterApiKey' | 'localLlmUrl' | 'localLlmModelAnswer' | 'localLlmModelEvaluate'
        | 'nillionUserId' | 'nillionNodeKeyPath' | 'nillionBootnodes' | 'nillionPaymentsContractAddress'
        | 'nillionComputeActionId' | 'nilaiApiKey' | 'nilaiApiUrl' // Correct Nillion keys
        | 'llmModelIdentifier'
    >
    & Pick<AppConfig,
        | 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid'
        | 'fvmAggregatorContractF4Address'
        | 'openRouterApiKey' | 'localLlmUrl' | 'localLlmModelAnswer' | 'localLlmModelEvaluate'
        | 'nillionUserId' | 'nillionNodeKeyPath' | 'nillionBootnodes' | 'nillionPaymentsContractAddress'
        | 'nillionComputeActionId' | 'nilaiApiKey' | 'nilaiApiUrl' // Correct Nillion keys
        | 'llmModelIdentifier'
    >
>;


const finalConfig = loadedConfig as FinalConfig;

export default finalConfig;
// ==== ./packages/backend/src/config.ts ====