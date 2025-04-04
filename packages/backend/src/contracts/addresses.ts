// ./packages/backend/src/contracts/addresses.ts
import config from '../config';

export const KINTASK_COMMITMENT_CONTRACT_ADDRESS = config.kintaskContractAddress || '';
export const FVM_AGGREGATOR_CONTRACT_ADDRESS = config.fvmAggregatorContractAddress || '';

if (!KINTASK_COMMITMENT_CONTRACT_ADDRESS && process.env.NODE_ENV !== 'test') {
    console.warn("Backend Config Warning: KINTASK_CONTRACT_ADDRESS is not set in .env!");
}
if (!FVM_AGGREGATOR_CONTRACT_ADDRESS && process.env.NODE_ENV !== 'test') {
    console.warn("Backend Config Warning: FVM_AGGREGATOR_CONTRACT_ADDRESS is not set in .env!");
}