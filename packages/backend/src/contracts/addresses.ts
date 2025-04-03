import config from '../config';

export const KINTASK_COMMITMENT_CONTRACT_ADDRESS = config.kintaskContractAddress || '';

// Add other contract addresses if needed

if (!KINTASK_COMMITMENT_CONTRACT_ADDRESS && process.env.NODE_ENV !== 'test') { // Don't warn during tests maybe
    console.warn("Backend Config Warning: KintaskCommitment Contract address (KINTASK_CONTRACT_ADDRESS) is not set in .env!");
}
