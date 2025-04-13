// packages/backend/src/config.ts
import dotenv from 'dotenv';
import path from 'path';

const envPath = path.resolve(__dirname, '../.env');
console.log(`[Config - Backend] Attempting to load .env from: ${envPath}`);
const dotenvResult = dotenv.config({ path: envPath });

if (dotenvResult.error) {
    console.error(`[Config - Backend] FATAL ERROR loading .env file from ${envPath}:`, dotenvResult.error);
    process.exit(1);
} else if (dotenvResult.parsed) {
    console.log(`[Config - Backend] Successfully loaded .env file from: ${envPath}`);
} else {
    console.warn(`[Config - Backend] dotenv.config() finished but no variables were parsed from ${envPath}. Ensure the file exists and has content.`);
}

// Check if we're in local test mode
const isLocalTest = process.env.IS_LOCAL_TEST?.toLowerCase() === 'true';
if (isLocalTest) {
    console.log('[Config - Backend] 🚧 Running in LOCAL TEST mode 🚧');
}

interface AppConfig {
    port: number | string;
    isLocalTest: boolean;
    localRpcUrl?: string; // RPC URL for local hardhat/anvil node

    // Recall Service Configuration
    recallPrivateKey?: string; // Private key for interacting with Recall
    recallLogBucket?: string; // Recall bucket name/address for logs

    // FVM/Blockchain Network Configuration (L1/Filecoin Hyperspace/Mainnet)
    fvmRpcUrl?: string; // Primary FVM RPC URL
    fvmRpcFallbackUrls?: string[]; // Fallback FVM RPC URLs

    // Layer 2 (e.g., Base Sepolia/Mainnet) Network Configuration
    l2RpcUrl?: string; // Primary L2 RPC URL
    l2RpcFallbackUrls?: string[]; // Fallback L2 RPC URLs

    // Wallet Configuration
    walletPrivateKey?: string; // Primary private key for sending transactions (may fallback to recallPrivateKey)

    // Contract Addresses
    fvmAggregatorContractAddress?: string; // Address for ZKP Aggregator on FVM (if used)
    fvmAggregatorContractF4Address?: string; // F4 Address for FVM Aggregator (if used)
    kintaskContractAddress?: string; // Your main KinTask contract address (if applicable)
    blocklockSenderProxyAddress?: string; // Blocklock proxy address (if used)
    easContractAddress?: string; // <<< ADDED: EAS Contract Address (e.g., on Base Sepolia)
    erc20PaymentStatementAddress?: string; // <<< ADDED: Your deployed ERC20PaymentStatement contract
    stringResultStatementAddress?: string; // <<< ADDED: Your deployed StringResultStatement contract (if used)
    answerStatementAddress?: string; // <<< ADDED: Your deployed AnswerStatement contract
    zkpValidatorAddress?: string; // <<< ADDED: Your deployed ZKPValidator contract

    // IPFS & w3up Configuration
    ipfsGatewayUrl: string; // Public IPFS gateway URL
    w3upAgentEmail?: string; // Email for w3up agent (if using w3up uploads)
    kintaskSpaceDid?: string; // DID for the w3up space used by KinTask

    // LLM Provider Selection
    llmProvider?: 'openrouter' | 'local' | 'nillion'; // Which LLM service to use
    llmModelIdentifier?: string; // Specific model name/ID for the chosen provider

    // OpenRouter Configuration
    openRouterApiKey?: string;

    // Local LLM Server Configuration
    localLlmUrl?: string; // URL of your local LLM inference server
    localLlmModelAnswer?: string; // Model identifier for answering questions (local)
    localLlmModelEvaluate?: string; // Model identifier for evaluating answers (local)

    // Nillion Configuration
    nillionUserId?: string;
    nillionNodeKeyPath?: string;
    nillionBootnodes?: string[];
    nillionPaymentsContractAddress?: string;
    nillionComputeActionId?: string;
    nilaiApiKey?: string; // API key for NIL-AI service
    nilaiApiUrl?: string; // URL for NIL-AI service

    // Gas Limit Configuration (Optional with defaults)
    fvmGasLimitCreatePayment?: number;
    fvmGasLimitCollectPayment?: number;
    fvmGasLimitValidateZKP?: number;
}

// Load configuration from environment variables
const loadedConfig: AppConfig = {
    port: process.env.PORT || 3001,
    isLocalTest,
    localRpcUrl: process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545', // Default local RPC

    recallPrivateKey: process.env.RECALL_PRIVATE_KEY,
    recallLogBucket: process.env.RECALL_LOG_BUCKET,

    // --- FVM Network ---
    fvmRpcUrl: isLocalTest ? (process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545') : process.env.FVM_RPC_URL,
    fvmRpcFallbackUrls: (isLocalTest
        ? [process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545']
        : process.env.FVM_RPC_FALLBACK_URLS?.split(',').map(url => url.trim()) || []
        ).filter(Boolean) as string[], // Filter out empty strings

    // --- L2 Network ---
    // Default L2 to local RPC if in local test mode, otherwise use L2_RPC_URL
    l2RpcUrl: isLocalTest ? (process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545') : process.env.L2_RPC_URL,
    l2RpcFallbackUrls: (isLocalTest
        ? [process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545']
        : process.env.L2_RPC_FALLBACK_URLS?.split(',').map(url => url.trim()) || []
        ).filter(Boolean) as string[], // Filter out empty strings

    // --- Wallet ---
    // Default local test wallet key if not set, otherwise use WALLET_PRIVATE_KEY
    walletPrivateKey: isLocalTest ? (process.env.LOCALHOST_OWNER_PRIVATE_KEY || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') : process.env.WALLET_PRIVATE_KEY, // Default Hardhat key 0 for local

    // --- Contract Addresses ---
    // Use specific localhost addresses if in local test, otherwise use env vars
    fvmAggregatorContractAddress: isLocalTest ? process.env.LOCALHOST_ZKP_AGGREGATOR_ADDRESS : process.env.FVM_AGGREGATOR_CONTRACT_ADDRESS,
    fvmAggregatorContractF4Address: process.env.FVM_AGGREGATOR_CONTRACT_F4_ADDRESS, // No local default for this usually
    kintaskContractAddress: process.env.KINTASK_CONTRACT_ADDRESS, // May or may not have a local equivalent
    blocklockSenderProxyAddress: process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS, // May or may not have a local equivalent
    // EAS/Statement Contracts (Use specific env vars, potentially with local defaults if you deploy locally)
    easContractAddress: process.env.EAS_CONTRACT_ADDRESS, // e.g., Base Sepolia EAS address
    erc20PaymentStatementAddress: process.env.ERC20_PAYMENT_STATEMENT_ADDRESS,
    stringResultStatementAddress: process.env.STRING_RESULT_STATEMENT_ADDRESS,
    answerStatementAddress: process.env.ANSWER_STATEMENT_ADDRESS,
    zkpValidatorAddress: process.env.ZKP_VALIDATOR_ADDRESS, // <<< ADDED ZKP Validator Address

    // --- IPFS / w3up ---
    ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/', // Default public gateway
    w3upAgentEmail: process.env.W3UP_AGENT_EMAIL,
    kintaskSpaceDid: process.env.KINTASK_SPACE_DID,

    // --- LLM Configuration ---
    llmProvider: (process.env.LLM_PROVIDER?.toLowerCase() === 'local' ? 'local' :
        (process.env.LLM_PROVIDER?.toLowerCase() === 'nillion' ? 'nillion' : 'openrouter')) as 'openrouter' | 'local' | 'nillion' | undefined,
    llmModelIdentifier: process.env.LLM_MODEL_IDENTIFIER, // e.g., 'openai/gpt-4' or local model name
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    localLlmUrl: process.env.LOCAL_LLM_URL || 'http://localhost:11434', // Default local Ollama URL
    localLlmModelAnswer: process.env.LOCAL_LLM_MODEL_ANSWER || 'llama2', // Default local model
    localLlmModelEvaluate: process.env.LOCAL_LLM_MODEL_EVALUATE || 'llama2', // Default local model
    nillionUserId: process.env.NILLION_USER_ID,
    nillionNodeKeyPath: process.env.NILLION_NODE_KEY_PATH,
    nillionBootnodes: process.env.NILLION_BOOTNODES?.split(',').map(url => url.trim()).filter(Boolean) as string[] | undefined, // Ensure filter and type cast
    nillionPaymentsContractAddress: process.env.NILLION_PAYMENTS_CONTRACT_ADDRESS,
    nillionComputeActionId: process.env.NILLION_COMPUTE_ACTION_ID,
    nilaiApiKey: process.env.NILAI_API_KEY,
    nilaiApiUrl: process.env.NILAI_API_URL,

    // --- Gas Limits (Load from env or use defaults) ---
    fvmGasLimitCreatePayment: parseInt(process.env.FVM_GAS_LIMIT_CREATE_PAYMENT || '800000', 10),
    fvmGasLimitCollectPayment: parseInt(process.env.FVM_GAS_LIMIT_COLLECT_PAYMENT || '800000', 10),
    fvmGasLimitValidateZKP: parseInt(process.env.FVM_GAS_LIMIT_VALIDATE_ZKP || '1500000', 10),
};

// --- Log Network Mode ---
if (isLocalTest) {
    console.log(`[Config - Backend] Using LOCAL network settings:`);
    console.log(`  - RPC URL: ${loadedConfig.localRpcUrl}`);
} else {
    console.log(`[Config - Backend] Using LIVE network settings.`);
    console.log(`  - FVM RPC URL: ${loadedConfig.fvmRpcUrl}`);
    console.log(`  - L2 RPC URL: ${loadedConfig.l2RpcUrl}`);
}
console.log(`  - Contract Addresses:`);
console.log(`    - EAS: ${loadedConfig.easContractAddress || 'Not Set'}`);
console.log(`    - ERC20PaymentStatement: ${loadedConfig.erc20PaymentStatementAddress || 'Not Set'}`);
// console.log(`    - StringResultStatement: ${loadedConfig.stringResultStatementAddress || 'Not Set'}`); // Log if used
console.log(`    - AnswerStatement: ${loadedConfig.answerStatementAddress || 'Not Set'}`);
console.log(`    - ZKPValidator: ${loadedConfig.zkpValidatorAddress || 'Not Set'}`);


// --- Log Selected LLM Provider ---
console.log(`[Config - Backend] Selected LLM Provider: ${loadedConfig.llmProvider || 'Default (openrouter assumed)'}`);
if (loadedConfig.llmProvider === 'local') console.log(`[Config - Backend] Using Local LLM URL: ${loadedConfig.localLlmUrl}`);
if (loadedConfig.llmProvider === 'nillion') console.log(`[Config - Backend] Using Nillion NIL-AI URL: ${loadedConfig.nilaiApiUrl}`);
if (loadedConfig.llmProvider === 'openrouter') console.log(`[Config - Backend] Using OpenRouter (API key loaded: ${!!loadedConfig.openRouterApiKey})`);
if (loadedConfig.llmModelIdentifier) console.log(`[Config - Backend] Using LLM Model: ${loadedConfig.llmModelIdentifier}`);


// --- Apply Fallbacks for non-local environments ---
if (!isLocalTest) {
    // Fallback L2 RPC to FVM RPC if L2 is not specifically set
    if (!loadedConfig.l2RpcUrl && loadedConfig.fvmRpcUrl) {
        console.log(`[Config - Backend] Fallback: Using FVM_RPC_URL for l2RpcUrl.`);
        loadedConfig.l2RpcUrl = loadedConfig.fvmRpcUrl;
        // Also apply fallback URLs if L2 fallbacks aren't set but FVM ones are
        if ((loadedConfig.fvmRpcFallbackUrls?.length ?? 0) > 0 && (loadedConfig.l2RpcFallbackUrls?.length ?? 0) === 0) {
            console.log(`[Config - Backend] Fallback: Using FVM_RPC_FALLBACK_URLS for l2RpcFallbackUrls.`);
            loadedConfig.l2RpcFallbackUrls = loadedConfig.fvmRpcFallbackUrls;
        }
    }
    // Fallback wallet key to recall key if primary wallet key not set
    if (!loadedConfig.walletPrivateKey && loadedConfig.recallPrivateKey) {
        console.log(`[Config - Backend] Fallback: Using RECALL_PRIVATE_KEY for walletPrivateKey.`);
        loadedConfig.walletPrivateKey = loadedConfig.recallPrivateKey;
    }

    // Ensure primary URLs are included in the fallback arrays
    loadedConfig.fvmRpcFallbackUrls = Array.from(new Set([loadedConfig.fvmRpcUrl || '', ...(loadedConfig.fvmRpcFallbackUrls || [])])).filter(url => url);
    loadedConfig.l2RpcFallbackUrls = Array.from(new Set([loadedConfig.l2RpcUrl || '', ...(loadedConfig.l2RpcFallbackUrls || [])])).filter(url => url);
} else {
    // Ensure local URL is in fallback arrays for local testing consistency
     loadedConfig.fvmRpcFallbackUrls = [loadedConfig.localRpcUrl].filter(Boolean) as string[];
     loadedConfig.l2RpcFallbackUrls = [loadedConfig.localRpcUrl].filter(Boolean) as string[];
}


// --- Define required environment variables ---
// Adjust required keys based on whether it's local test or not
const requiredEnvKeys: (keyof AppConfig)[] = isLocalTest
    ? ['localRpcUrl', 'llmProvider', 'walletPrivateKey', 'easContractAddress', 'answerStatementAddress', 'zkpValidatorAddress', 'erc20PaymentStatementAddress'] // Essentials for local testing EAS flow
    : [ // Essentials for a typical deployment
        'recallPrivateKey', 'walletPrivateKey',
        'fvmRpcUrl', 'l2RpcUrl', // Or fallbacks must result in a URL
        'easContractAddress', 'answerStatementAddress', 'zkpValidatorAddress', 'erc20PaymentStatementAddress',
        'llmProvider',
        // Add others like Kintask/Blocklock if essential for your deployment
        // 'kintaskContractAddress', 'blocklockSenderProxyAddress',
    ];

let missingVars = false;
console.log("[Config - Backend] Checking required configuration values...");
requiredEnvKeys.forEach((key) => {
    const value = loadedConfig[key];
     // Check for empty strings, null, or undefined. For arrays, check length.
    const isMissing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (isMissing) {
        // Construct the expected environment variable name (simple uppercase heuristic)
        const envVarName = key.replace(/([A-Z])/g, '_$1').toUpperCase();
        console.error(`[Config - Backend] FATAL ERROR: Required config '${key}' missing or invalid. Check .env for: ${envVarName}`);
        missingVars = true;
    }
});

// Check provider-specific requirements more robustly
if (loadedConfig.llmProvider === 'openrouter' && !loadedConfig.openRouterApiKey) {
    console.error(`[Config - Backend] FATAL ERROR: llmProvider='openrouter' but OPENROUTER_API_KEY missing.`);
    missingVars = true;
}
// No fatal error for missing local URL, service might have internal default
// if (loadedConfig.llmProvider === 'local' && !loadedConfig.localLlmUrl) {
//     console.warn(`[Config - Backend] Warning: llmProvider='local' but LOCAL_LLM_URL not set. Using default.`);
// }
if (loadedConfig.llmProvider === 'nillion' && (!loadedConfig.nilaiApiKey || !loadedConfig.nilaiApiUrl)) {
    console.error(`[Config - Backend] FATAL ERROR: llmProvider='nillion' but NILAI_API_KEY or NILAI_API_URL missing.`);
    missingVars = true;
}

// Ensure at least one RPC url is available after fallbacks
if (!loadedConfig.fvmRpcFallbackUrls?.length) {
    console.error(`[Config - Backend] FATAL ERROR: No FVM RPC URLs available after processing config and fallbacks.`);
    missingVars = true;
}
if (!loadedConfig.l2RpcFallbackUrls?.length) {
    console.error(`[Config - Backend] FATAL ERROR: No L2 RPC URLs available after processing config and fallbacks.`);
     missingVars = true;
}


if (missingVars) {
    console.error("\n[Config - Backend] Please configure required variables in .env and restart.");
    process.exit(1);
}

console.log("[Config - Backend] Environment variables processed successfully.");

// --- Export the validated config as Readonly ---
const finalConfig = loadedConfig as Readonly<AppConfig>;

export default finalConfig;