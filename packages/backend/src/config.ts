// ./packages/backend/src/config.ts
import dotenv from 'dotenv';
import path from 'path';

// --- Adjust .env path resolution ---
const envPath = path.resolve(__dirname, '../.env'); // Path relative to src/config.ts -> packages/backend/.env
console.log(`[Config] Attempting to load .env from: ${envPath}`);
const dotenvResult = dotenv.config({ path: envPath });

if (dotenvResult.error) {
    console.error(`[Config] FATAL ERROR loading .env file from ${envPath}:`, dotenvResult.error);
    process.exit(1); // Exit if .env cannot be loaded from the primary path
} else if (dotenvResult.parsed) {
     console.log(`[Config] Successfully loaded .env file from: ${envPath}`);
} else {
     console.warn(`[Config] dotenv.config() finished without error but no variables were parsed from ${envPath}.`);
}

// --- Define configuration structure ---
interface AppConfig {
  port: number | string;
  recallPrivateKey?: string;
  recallLogBucket?: string;
  fvmRpcUrl?: string;
  fvmAggregatorContractAddress?: string;
  l2RpcUrl?: string;
  walletPrivateKey?: string;
  kintaskContractAddress?: string;
  blocklockSenderProxyAddress?: string;
  openRouterApiKey?: string;
  ipfsGatewayUrl: string;
  w3upAgentEmail?: string;
  kintaskSpaceDid?: string;
  // knowledgeBaseIndexCid is NOT defined here - it's dynamic
}

// --- Load primary values from process.env ---
const loadedConfig: AppConfig = {
  port: process.env.PORT || 3001,
  recallPrivateKey: process.env.RECALL_PRIVATE_KEY,
  recallLogBucket: process.env.RECALL_LOG_BUCKET,
  fvmRpcUrl: process.env.FVM_RPC_URL,
  fvmAggregatorContractAddress: process.env.FVM_AGGREGATOR_CONTRACT_ADDRESS,
  l2RpcUrl: process.env.L2_RPC_URL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  kintaskContractAddress: process.env.KINTASK_CONTRACT_ADDRESS,
  blocklockSenderProxyAddress: process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/',
  w3upAgentEmail: process.env.W3UP_AGENT_EMAIL,
  kintaskSpaceDid: process.env.KINTASK_SPACE_DID,
};

// --- Apply Fallbacks ---
if (!loadedConfig.l2RpcUrl && loadedConfig.fvmRpcUrl) {
    console.log(`[Config] Applying fallback: Using FVM_RPC_URL for l2RpcUrl.`);
    loadedConfig.l2RpcUrl = loadedConfig.fvmRpcUrl;
}
if (!loadedConfig.walletPrivateKey && loadedConfig.recallPrivateKey) {
    console.log(`[Config] Applying fallback: Using RECALL_PRIVATE_KEY for walletPrivateKey.`);
    loadedConfig.walletPrivateKey = loadedConfig.recallPrivateKey;
}

// --- Define required variables for core functionality ---
// *** knowledgeBaseIndexCid IS NOT IN THIS LIST ***
const requiredConfigKeys: Array<keyof Omit<AppConfig, 'knowledgeBaseIndexCid' | 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid'>> = [
    'recallPrivateKey',
    'fvmRpcUrl',
    'fvmAggregatorContractAddress',
    'openRouterApiKey',
    'l2RpcUrl', // Checked after fallback applied
    'walletPrivateKey', // Checked after fallback applied
    'kintaskContractAddress',
    'blocklockSenderProxyAddress',
];

let missingVars = false;
console.log("[Config] Checking required configuration values...");
requiredConfigKeys.forEach((key) => {
  if (!(loadedConfig as any)[key]) { // Check if the key exists and has a value in the loaded config
      let missingDetail = key.toUpperCase();
      if (key === 'l2RpcUrl') missingDetail = 'L2_RPC_URL (or FVM_RPC_URL fallback)';
      if (key === 'walletPrivateKey') missingDetail = 'WALLET_PRIVATE_KEY (or RECALL_PRIVATE_KEY fallback)';

      console.error(`[Config] FATAL ERROR: Required config value '${key}' is missing. Env var needed: ${missingDetail}.`);
      missingVars = true;
  }
});

// Optional: Check for recallLogBucket but don't make it fatal
if (!loadedConfig.recallLogBucket) {
    console.log(`[Config] Info: Optional config value 'recallLogBucket' not set. Will use alias to find/create.`);
}

if (missingVars) {
    console.error("\nPlease configure required variables in packages/backend/.env file and restart.");
    process.exit(1);
}

console.log("[Config] Environment variables and configuration processed successfully.");

// --- Export the validated and potentially modified config ---
const finalConfig = loadedConfig as Readonly<Required<Omit<AppConfig, 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid'>> & Pick<AppConfig, 'recallLogBucket' | 'w3upAgentEmail' | 'kintaskSpaceDid'>>;

export default finalConfig;
// ==== ./packages/backend/src/config.ts ====