import config from '../config';

export const KINTASK_COMMITMENT_CONTRACT_ADDRESS = config.kintaskContractAddress || '';

// Add other contract addresses if needed

// Warning moved to config.ts for earlier exit
// if (!KINTASK_COMMITMENT_CONTRACT_ADDRESS || KINTASK_COMMITMENT_CONTRACT_ADDRESS === 'PASTE_DEPLOYED_ADDRESS_HERE') {
//     console.warn("Backend Config Warning: KintaskCommitment Contract address is not set or is placeholder!");
// }
