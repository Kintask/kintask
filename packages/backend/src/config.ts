import dotenv from 'dotenv';
import path from 'path';

// Load .env file specifically from the backend package root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config = {
  port: process.env.PORT || 3001,
  openaiApiKey: process.env.OPENAI_API_KEY,
  web3StorageToken: process.env.WEB3STORAGE_TOKEN,
  recallApiKey: process.env.RECALL_API_KEY, // Placeholder
  recallApiEndpoint: process.env.RECALL_API_ENDPOINT, // Placeholder
  knowledgeBaseIndexCid: process.env.KB_INDEX_CID,
  l2RpcUrl: process.env.L2_RPC_URL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  kintaskContractAddress: process.env.KINTASK_CONTRACT_ADDRESS,
  blocklockSenderProxyAddress: process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS,
};

// Runtime validation for critical variables
const requiredEnvVars: Array<keyof typeof config> = [
    'openaiApiKey',
    'web3StorageToken',
    // 'recallApiKey', // Optional for MVP simulation
    // 'recallApiEndpoint', // Optional for MVP simulation
    'knowledgeBaseIndexCid',
    'l2RpcUrl',
    'walletPrivateKey',
    'kintaskContractAddress',
    'blocklockSenderProxyAddress',
];

let missingVars = false;
requiredEnvVars.forEach((varName) => {
  // Allow recall vars to be missing for simulation
  if (varName.startsWith('recall') && (!config[varName])) {
      console.warn(`Warning: Optional environment variable ${varName} is not set. Recall logging will be simulated.`);
      return;
  }
  if (!config[varName]) {
    console.error(`FATAL ERROR: Environment variable ${varName} is not set in packages/backend/.env`);
    missingVars = true;
  }
});

// Perform KB_INDEX_CID check specifically after initial loop, as it might be 'PASTE_INDEX_CID_HERE'
if (config.knowledgeBaseIndexCid === 'PASTE_INDEX_CID_HERE') {
     console.error(`FATAL ERROR: Environment variable KB_INDEX_CID is still set to placeholder "PASTE_INDEX_CID_HERE" in packages/backend/.env`);
     console.error("Please run 'pnpm kg:upload' and paste the output Index CID into the .env file.");
     missingVars = true;
}
// Perform KINTASK_CONTRACT_ADDRESS check specifically
if (config.kintaskContractAddress === 'PASTE_DEPLOYED_ADDRESS_HERE') {
    console.error(`FATAL ERROR: Environment variable KINTASK_CONTRACT_ADDRESS is still set to placeholder "PASTE_DEPLOYED_ADDRESS_HERE" in packages/backend/.env`);
    console.error("Please run 'pnpm contracts:deploy --network <your_network>' and paste the deployed address into the .env file.");
    missingVars = true;
}


if (missingVars) {
    console.error("\nPlease configure the required variables in packages/backend/.env and restart.");
    process.exit(1); // Exit if critical config is missing
}

export default config;
