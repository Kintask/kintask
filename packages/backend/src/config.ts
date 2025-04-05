// ./packages/backend/src/config.ts
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config = {
  port: process.env.PORT || 3001,
  openRouterApiKey: process.env.OPENROUTER_API_KEY, // Or OPENAI_API_KEY
  w3upAgentEmail: process.env.W3UP_AGENT_EMAIL,
  kintaskSpaceDid: process.env.KINTASK_SPACE_DID,
  // knowledgeBaseIndexCid: process.env.KB_INDEX_CID, // Removed: Now provided per-request
  ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/',
  recallPrivateKey: process.env.RECALL_PRIVATE_KEY,
  recallLogBucket: process.env.RECALL_LOG_BUCKET,
  l2RpcUrl: process.env.L2_RPC_URL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  kintaskContractAddress: process.env.KINTASK_CONTRACT_ADDRESS,
  blocklockSenderProxyAddress: process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS,
  fvmAggregatorContractAddress: process.env.FVM_AGGREGATOR_CONTRACT_ADDRESS,
};

const requiredEnvVars: Array<keyof typeof config> = [
    'openRouterApiKey', // Or OPENAI_API_KEY
    'w3upAgentEmail',
    'kintaskSpaceDid',
    // 'knowledgeBaseIndexCid', // Removed
    'l2RpcUrl',
    'walletPrivateKey',
    'kintaskContractAddress',
    'blocklockSenderProxyAddress',
    'recallPrivateKey',
    'fvmAggregatorContractAddress',
];

let missingVars = false;
requiredEnvVars.forEach((varName) => {
  if (!config[varName]) {
    if (varName === 'recallLogBucket') {
        console.log(`Info: Optional env var ${varName} not set.`);
        return;
    }
    console.error(`FATAL ERROR: Env var ${varName} is not set in packages/backend/.env`);
    missingVars = true;
  }
});

if (missingVars) {
    console.error("\nPlease configure required variables in packages/backend/.env and restart.");
    process.exit(1);
}

export default config;