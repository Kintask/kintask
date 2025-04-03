// config.ts
import dotenv from 'dotenv';
import path from 'path';

// Load .env file specifically from the backend package root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config = {
  port: process.env.PORT || 3001,
  // OpenRouter Config
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  // W3UP/Storacha Config (Keep for potential use even if not in current files)
  w3upAgentEmail: process.env.W3UP_AGENT_EMAIL,
  kintaskSpaceDid: process.env.KINTASK_SPACE_DID,
  // KG Index CID
  knowledgeBaseIndexCid: process.env.KB_INDEX_CID,
  // IPFS Gateway for Retrieval (Optional Override)
  ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/', // Default to w3s.link
  // Recall Config (Updated based on recallService.ts usage)
  recallPrivateKey: process.env.RECALL_PRIVATE_KEY, // Private key for Recall wallet
  recallLogBucket: process.env.RECALL_LOG_BUCKET, // Optional: Pre-configured bucket address
  // L2 & Wallet Config (Used by timelockService and contracts)
  l2RpcUrl: process.env.L2_RPC_URL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // Main wallet for contract interaction
  kintaskContractAddress: process.env.KINTASK_CONTRACT_ADDRESS,
  blocklockSenderProxyAddress: process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS,
};

// Runtime validation for critical variables
// Recall variables are now critical for its functionality
const requiredEnvVars: Array<keyof typeof config> = [
    'openRouterApiKey',
    // 'w3upAgentEmail', // Keeping these optional for now if not directly used by core verification flow
    // 'kintaskSpaceDid',
    'l2RpcUrl',
    'walletPrivateKey', // Main wallet for timelock
    'kintaskContractAddress',
    'blocklockSenderProxyAddress',
    'recallPrivateKey', // Required for Recall logging
];

let missingVars = false;
requiredEnvVars.forEach((varName) => {
  // Allow KB_INDEX_CID to be missing initially
  if (varName === 'knowledgeBaseIndexCid' && !config[varName]) {
      console.warn(`Warning: ${varName} is not set. Run the KG upload script ('pnpm kg:upload') first.`);
      return; // Don't mark as fatal error yet
  }
  if (!config[varName]) {
    // Special handling for optional recallLogBucket
    if (varName === 'recallLogBucket') {
        console.log(`Info: Optional environment variable ${varName} is not set. Recall service will attempt to find/create the bucket.`);
    } else {
        console.error(`FATAL ERROR: Environment variable ${varName} is not set in packages/backend/.env`);
        missingVars = true;
    }
  }
});

// Check KB_INDEX_CID specifically as it's needed by filecoinService
if (!config.knowledgeBaseIndexCid) {
    console.warn(`Warning: knowledgeBaseIndexCid (KB_INDEX_CID) is not set. Filecoin service (verifier) cannot function correctly.`);
    // Decide if this should be fatal or just a warning depending on requirements
    // missingVars = true; // Uncomment to make it fatal
}

// Validate Space DID format (basic check) - Keep validation if needed elsewhere
if (config.kintaskSpaceDid && !config.kintaskSpaceDid.startsWith('did:key:')) {
    console.error(`FATAL ERROR: KINTASK_SPACE_DID (${config.kintaskSpaceDid}) in packages/backend/.env does not look like a valid did:key identifier.`);
    missingVars = true; // Treat as fatal
}


if (missingVars) {
    console.error("\nPlease configure the required variables in packages/backend/.env and restart.");
    process.exit(1); // Exit if critical config is missing
}

export default config;