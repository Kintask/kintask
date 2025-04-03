import config from '../config';

// Example utility: Build L2 Explorer URL based on configured RPC URL heuristics
export function getL2ExplorerUrl(txHash: string): string | undefined {
    const rpcUrl = config.l2RpcUrl?.toLowerCase() || '';
    if (!rpcUrl || !txHash) return undefined;

    // Add more mappings as needed for supported testnets/mainnets
    if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
        return `https://sepolia.basescan.org/tx/${txHash}`;
    }
    if (rpcUrl.includes('optimism-sepolia') || rpcUrl.includes('11155420')) {
        return `https://sepolia-optimism.etherscan.io/tx/${txHash}`;
    }
     if (rpcUrl.includes('arbitrum-sepolia') || rpcUrl.includes('421614')) {
         return `https://sepolia.arbiscan.io/tx/${txHash}`;
     }
    // Add Polygon Amoy, etc.
    if (rpcUrl.includes('polygon-amoy') || rpcUrl.includes('80002')) {
        return `https://www.oklink.com/amoy/tx/${txHash}`;
    }

    console.warn(`[Utils] No block explorer URL configured for RPC: ${rpcUrl}`);
    return undefined; // Return undefined if no match
}

// Add other shared utility functions here, e.g., text truncation, basic NLP helpers
export function truncateText(text: string | undefined | null, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}
