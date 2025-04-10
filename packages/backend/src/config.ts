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

  // LLM Provider Configuration
  llmProvider: 'openrouter' | 'huggingface' | 'nillion'; // Added 'nillion'
  openRouterApiKey?: string;
  huggingfaceApiKey?: string;
  nilaiApiUrl?: string;       // Nillion API URL
  nilaiApiKey?: string;       // Nillion API Key
  llmModelIdentifier: string; // Model ID (might differ per provider)

  ipfsGatewayUrl: string;
  w3upAgentEmail?: string;
  kintaskSpaceDid?: string;

  // Localhost specific
  localhostRpcUrl?: string;
  localhostOwnerPrivateKey?: string;
  localhostVerifierAddress?: string;
  localhostZkpAggregatorAddress?: string;
}

// Determine LLM Provider
const llmProviderEnv = process.env.LLM_PROVIDER?.toLowerCase();
let selectedProvider: AppConfig['llmProvider'];
if (llmProviderEnv === 'huggingface' || llmProviderEnv === 'hf') {
    selectedProvider = 'huggingface';
} else if (llmProviderEnv === 'nillion') {
    selectedProvider = 'nillion';
} else {
    selectedProvider = 'openrouter'; // Default
}

// Set default model based on provider
let defaultModel = "mistralai/mistral-7b-instruct:free"; // OpenRouter default
if (selectedProvider === 'huggingface') {
    defaultModel = "mistralai/Mistral-7B-Instruct-v0.1"; // HF default
} else if (selectedProvider === 'nillion') {
    defaultModel = "meta-llama/Llama-3.1-8B-Instruct"; // Nillion default from example
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

  llmProvider: selectedProvider,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY,
  nilaiApiUrl: process.env.NILAI_API_URL, // Load Nillion URL
  nilaiApiKey: process.env.NILAI_API_KEY, // Load Nillion Key
  llmModelIdentifier: process.env.LLM_MODEL_IDENTIFIER || defaultModel, // Use specific or default

  ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/',
  w3upAgentEmail: process.env.W3UP_AGENT_EMAIL,
  kintaskSpaceDid: process.env.KINTASK_SPACE_DID,

  localhostRpcUrl: process.env.LOCALHOST_RPC_URL,
  localhostOwnerPrivateKey: process.env.LOCALHOST_OWNER_PRIVATE_KEY,
  localhostVerifierAddress: process.env.LOCALHOST_VERIFIER_ADDRESS,
  localhostZkpAggregatorAddress: process.env.LOCALHOST_ZKP_AGGREGATOR_ADDRESS,
};

// --- Apply Fallbacks ---
// ...(fallbacks remain the same)...
if (!loadedConfig.l2RpcUrl && loadedConfig.fvmRpcUrl) { loadedConfig.l2RpcUrl = loadedConfig.fvmRpcUrl; if (loadedConfig.fvmRpcFallbackUrls && loadedConfig.fvmRpcFallbackUrls.length > 0 && (!loadedConfig.l2RpcFallbackUrls || loadedConfig.l2RpcFallbackUrls.length === 0)) { loadedConfig.l2RpcFallbackUrls = loadedConfig.fvmRpcFallbackUrls; } }
if (!loadedConfig.recallPrivateKey && loadedConfig.walletPrivateKey) { loadedConfig.recallPrivateKey = loadedConfig.walletPrivateKey; }
loadedConfig.fvmRpcFallbackUrls = [loadedConfig.fvmRpcUrl || '', ...(loadedConfig.fvmRpcFallbackUrls || [])].filter(url => url);
loadedConfig.l2RpcFallbackUrls = [loadedConfig.l2RpcUrl || '', ...(loadedConfig.l2RpcFallbackUrls || [])].filter(url => url);

console.log(`[Config - Backend] Selected LLM Provider: ${loadedConfig.llmProvider}`);
console.log(`[Config - Backend] Using LLM Model: ${loadedConfig.llmModelIdentifier}`);


// --- Define required variables ---
const baseRequiredKeys: Array<keyof Omit<AppConfig,
    'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid' | 'fvmAggregatorContractF4Address' |
    'fvmRpcFallbackUrls' | 'l2RpcFallbackUrls' |
    'openRouterApiKey' | 'huggingfaceApiKey' | 'nilaiApiKey' | 'nilaiApiUrl' | // Exclude all provider-specific keys/urls
    'localhostRpcUrl' | 'localhostOwnerPrivateKey' | 'localhostVerifierAddress' | 'localhostZkpAggregatorAddress'
>> = [
    'recallPrivateKey', 'fvmRpcUrl', 'fvmAggregatorContractAddress', 'walletPrivateKey',
    'kintaskContractAddress', 'blocklockSenderProxyAddress', 'llmModelIdentifier',
];

// Add provider-specific key requirement
const providerSpecificRequiredKeys: Array<keyof AppConfig> = [];
if (loadedConfig.llmProvider === 'openrouter') {
    providerSpecificRequiredKeys.push('openRouterApiKey');
} else if (loadedConfig.llmProvider === 'huggingface') {
    providerSpecificRequiredKeys.push('huggingfaceApiKey');
} else if (loadedConfig.llmProvider === 'nillion') {
    providerSpecificRequiredKeys.push('nilaiApiKey');
    providerSpecificRequiredKeys.push('nilaiApiUrl'); // Nillion needs URL too
}

const requiredConfigKeys = [...baseRequiredKeys, ...providerSpecificRequiredKeys];

let missingVars = false;
console.log("[Config - Backend] Checking required configuration values...");
requiredConfigKeys.forEach((key) => {
    if (!loadedConfig[key]) {
        let missingDetail = key.toUpperCase();
        if (key === 'openRouterApiKey') missingDetail = 'OPENROUTER_API_KEY (for OpenRouter)';
        if (key === 'huggingfaceApiKey') missingDetail = 'HUGGINGFACE_API_KEY (for Hugging Face)';
        if (key === 'nilaiApiKey') missingDetail = 'NILAI_API_KEY (for Nillion)';
        if (key === 'nilaiApiUrl') missingDetail = 'NILAI_API_URL (for Nillion)';
        console.error(`[Config - Backend] FATAL ERROR: Required config value '${key}' missing: ${missingDetail}.`);
        missingVars = true;
    }
});

// ...(RPC URL checks remain the same)...
if (!loadedConfig.fvmRpcFallbackUrls || loadedConfig.fvmRpcFallbackUrls.length === 0) { console.error(`[Config - Backend] FATAL ERROR: No FVM RPC URLs available.`); missingVars = true; }
if (!loadedConfig.l2RpcFallbackUrls || loadedConfig.l2RpcFallbackUrls.length === 0) { console.error(`[Config - Backend] FATAL ERROR: No L2 RPC URLs available.`); missingVars = true; }

if (missingVars) {
    console.error("\n[Config - Backend] Please configure required variables in packages/backend/.env file and restart.");
    console.error("[Config - Backend] Set LLM_PROVIDER ('openrouter', 'huggingface', or 'nillion') and corresponding API keys/URLs.");
    process.exit(1);
}

console.log("[Config - Backend] Environment variables processed successfully.");

// --- Define Final Config Type ---
type OptionalKeys =
    | 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid' | 'fvmAggregatorContractF4Address'
    | 'openRouterApiKey' | 'huggingfaceApiKey' | 'nilaiApiKey' | 'nilaiApiUrl' // Keys/URLs are optional depending on provider
    | 'localhostRpcUrl' | 'localhostOwnerPrivateKey' | 'localhostVerifierAddress' | 'localhostZkpAggregatorAddress';
type RequiredConfig = Required<Omit<AppConfig, OptionalKeys>>;
type OptionalConfig = Partial<Pick<AppConfig, OptionalKeys>>;
type FinalConfig = Readonly<RequiredConfig & OptionalConfig>;

const finalConfig = loadedConfig as FinalConfig;
export default finalConfig;