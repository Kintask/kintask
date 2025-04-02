import config from '../config';

// Example utility: Build L2 Explorer URL based on configured RPC URL heuristics
export function getL2ExplorerUrl(txHash: string): string | undefined {
    const rpcUrl = config.l2RpcUrl?.toLowerCase() || '';
    if (!rpcUrl || !txHash || !txHash.startsWith('0x')) return undefined;

    // Add more mappings as needed for supported testnets/mainnets
    if (rpcUrl.includes('base') && rpcUrl.includes('sepolia') || rpcUrl.includes('84532')) {
        return `https://sepolia.basescan.org/tx/${txHash}`;
    }
    if (rpcUrl.includes('optimism') && rpcUrl.includes('sepolia') || rpcUrl.includes('11155420')) {
        return `https://sepolia-optimism.etherscan.io/tx/${txHash}`;
    }
     if (rpcUrl.includes('arbitrum') && rpcUrl.includes('sepolia') || rpcUrl.includes('421614')) {
         return `https://sepolia.arbiscan.io/tx/${txHash}`;
     }
    // Add Polygon Amoy, etc.
    if (rpcUrl.includes('polygon') && rpcUrl.includes('amoy') || rpcUrl.includes('80002')) {
         return `https://www.oklink.com/amoy/tx/${txHash}`;
    }

    console.warn(`[Utils] No block explorer URL configured for RPC containing hint: ${rpcUrl}`);
    // Attempt a generic Etherscan link as a fallback? Risky.
    // return `https://etherscan.io/tx/${txHash}`;
    return undefined; // Return undefined if no match
}

// Add other shared utility functions here, e.g., text truncation, basic NLP helpers
export function truncateText(text: string | undefined | null, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

// Basic keyword extraction (example, needs improvement)
export function extractKeywords(text: string, minLength = 4): string[] {
    if (!text) return [];
    // Simple regex: find sequences of alphanumeric chars >= minLength
    const words = text.toLowerCase().match(new RegExp(`\\b[a-zA-Z0-9]{${minLength},}\\b`, 'g'));
    if (!words) return [];
    // Optional: Filter common stop words (a, the, is, etc.) - requires a list
    return [...new Set(words)]; // Return unique keywords
}
