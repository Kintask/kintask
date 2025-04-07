// ./config.ts
// ./packages/backend/src/config.ts
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
  fvmRpcFallbackUrls?: string[]; // Added for fallbacks
  fvmAggregatorContractAddress?: string;
  fvmAggregatorContractF4Address?: string; // Added f4 address
  l2RpcUrl?: string;
  l2RpcFallbackUrls?: string[]; // Added for fallbacks
  walletPrivateKey?: string;
  kintaskContractAddress?: string;
  blocklockSenderProxyAddress?: string;
  openRouterApiKey?: string;
  ipfsGatewayUrl: string;
  w3upAgentEmail?: string;
  kintaskSpaceDid?: string;
}

const loadedConfig: AppConfig = {
  port: process.env.PORT || 3001,
  recallPrivateKey: process.env.RECALL_PRIVATE_KEY,
  recallLogBucket: process.env.RECALL_LOG_BUCKET,
  fvmRpcUrl: process.env.FVM_RPC_URL,
  // Parse comma-separated fallback URLs, trimming whitespace
  fvmRpcFallbackUrls: process.env.FVM_RPC_FALLBACK_URLS?.split(',').map(url => url.trim()).filter(url => url) || [],
  fvmAggregatorContractAddress: process.env.FVM_AGGREGATOR_CONTRACT_ADDRESS,
  fvmAggregatorContractF4Address: process.env.FVM_AGGREGATOR_CONTRACT_F4_ADDRESS,
  l2RpcUrl: process.env.L2_RPC_URL,
  l2RpcFallbackUrls: process.env.L2_RPC_FALLBACK_URLS?.split(',').map(url => url.trim()).filter(url => url) || [],
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  kintaskContractAddress: process.env.KINTASK_CONTRACT_ADDRESS,
  blocklockSenderProxyAddress: process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/',
  w3upAgentEmail: process.env.W3UP_AGENT_EMAIL,
  kintaskSpaceDid: process.env.KINTASK_SPACE_DID,
};

// --- Apply Fallbacks for primary URLs/Keys ---
if (!loadedConfig.l2RpcUrl && loadedConfig.fvmRpcUrl) {
    console.log(`[Config - Backend] Applying fallback: Using FVM_RPC_URL for l2RpcUrl.`);
    loadedConfig.l2RpcUrl = loadedConfig.fvmRpcUrl;
    // Also copy FVM fallbacks to L2 fallbacks if L2 primary was missing
    if (loadedConfig.fvmRpcFallbackUrls && loadedConfig.fvmRpcFallbackUrls.length > 0 && (!loadedConfig.l2RpcFallbackUrls || loadedConfig.l2RpcFallbackUrls.length === 0)) {
         console.log(`[Config - Backend] Applying fallback: Using FVM_RPC_FALLBACK_URLS for l2RpcFallbackUrls.`);
        loadedConfig.l2RpcFallbackUrls = loadedConfig.fvmRpcFallbackUrls;
    }
}
if (!loadedConfig.walletPrivateKey && loadedConfig.recallPrivateKey) {
    console.log(`[Config - Backend] Applying fallback: Using RECALL_PRIVATE_KEY for walletPrivateKey.`);
    loadedConfig.walletPrivateKey = loadedConfig.recallPrivateKey;
}

// Combine primary and fallback URLs for services to iterate through
loadedConfig.fvmRpcFallbackUrls = [loadedConfig.fvmRpcUrl || '', ...(loadedConfig.fvmRpcFallbackUrls || [])].filter(url => url);
loadedConfig.l2RpcFallbackUrls = [loadedConfig.l2RpcUrl || '', ...(loadedConfig.l2RpcFallbackUrls || [])].filter(url => url);


// --- Define required variables ---
const requiredConfigKeys: Array<keyof Omit<AppConfig, 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid' | 'fvmAggregatorContractF4Address' | 'fvmRpcFallbackUrls' | 'l2RpcFallbackUrls' >> = [ // Exclude fallbacks and optional from strict check
    'recallPrivateKey',
    'fvmRpcUrl', // Still require the primary one to be set
    'fvmAggregatorContractAddress',
    'openRouterApiKey',
    'l2RpcUrl',
    'walletPrivateKey',
    'kintaskContractAddress',
    'blocklockSenderProxyAddress',
];

let missingVars = false;
console.log("[Config - Backend] Checking required configuration values...");
requiredConfigKeys.forEach((key) => {
  if (!(loadedConfig as any)[key]) {
      let missingDetail = key.toUpperCase();
      if (key === 'l2RpcUrl') missingDetail = 'L2_RPC_URL (or FVM_RPC_URL fallback)';
      if (key === 'walletPrivateKey') missingDetail = 'WALLET_PRIVATE_KEY (or RECALL_PRIVATE_KEY fallback)';
      console.error(`[Config - Backend] FATAL ERROR: Required config value '${key}' is missing. Env var needed: ${missingDetail}.`);
      missingVars = true;
  }
});

// Add check to ensure at least one RPC url is available after fallbacks
if (!loadedConfig.fvmRpcFallbackUrls || loadedConfig.fvmRpcFallbackUrls.length === 0) {
     console.error(`[Config - Backend] FATAL ERROR: No FVM RPC URLs available (check FVM_RPC_URL and FVM_RPC_FALLBACK_URLS).`);
     missingVars = true;
}
if (!loadedConfig.l2RpcFallbackUrls || loadedConfig.l2RpcFallbackUrls.length === 0) {
     console.error(`[Config - Backend] FATAL ERROR: No L2 RPC URLs available (check L2_RPC_URL, L2_RPC_FALLBACK_URLS and FVM fallbacks).`);
     missingVars = true;
}


if (missingVars) {
    console.error("\n[Config - Backend] Please configure required variables in packages/backend/.env file and restart.");
    process.exit(1);
}

console.log("[Config - Backend] Environment variables and configuration processed successfully.");

// --- Export the validated config ---
// Define a more precise type for the exported config
type FinalConfig = Readonly<
    Required<Omit<AppConfig, 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid' | 'fvmAggregatorContractF4Address'>> // Most are required
    & Pick<AppConfig, 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid' | 'fvmAggregatorContractF4Address'> // Optional ones
>;

const finalConfig = loadedConfig as FinalConfig; // Assert type after validation

export default finalConfig;
// ==== ./packages/backend/src/config.ts =====