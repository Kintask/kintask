// kintask/packages/backend/src/services/filecoinService.ts

import axios, { AxiosError } from 'axios';
import config from '../config'; // Import configuration to get gateway URL and index CID
import { KnowledgeFragment } from '../types'; // Import the structure definition

// --- Configuration ---
// Use the gateway specified in config, defaulting to a reliable public one (w3s.link)
const IPFS_GATEWAY = config.ipfsGatewayUrl || 'https://w3s.link/ipfs/';
const MAX_RETRIES = 3; // Number of retry attempts for failed fetches
const RETRY_DELAY_MS = 800; // Initial delay before retrying (will increase exponentially)
const REQUEST_TIMEOUT = 25000; // Timeout for each HTTP request in milliseconds (25 seconds)

console.log(`[Filecoin Service] Using IPFS Gateway for retrieval: ${IPFS_GATEWAY}`);

// Structure expected in the index file uploaded to Filecoin/Storacha
interface IndexFileStructure {
    createdAt: string;
    description?: string;
    fragmentsById?: Record<string, string>; // fragment_id -> cid map (optional)
    index: Record<string, string[]>; // keyword -> [cid] map - Primary index used
    indexRootCid?: string; // Optional: CID of the directory containing all fragments
}

// Simple in-memory cache with TTL (Time To Live) in milliseconds
interface CacheEntry<T> {
    data: T;
    timestamp: number; // When the data was cached
}
const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 10 * 60 * 1000; // Cache validity duration (e.g., 10 minutes)

// --- Cache Utility Functions ---

/**
 * Stores data in the in-memory cache.
 * @param key - The cache key (typically the CID).
 * @param data - The data to store.
 */
function setCache<T>(key: string, data: T) {
    if (!key) return; // Do not cache with empty key
    cache.set(key, { data, timestamp: Date.now() });
    // console.log(`[Cache] Set cache for key: ${key.substring(0,10)}...`);
}

/**
 * Retrieves data from the cache if it exists and is not expired.
 * @param key - The cache key (typically the CID).
 * @returns The cached data or null if not found or expired.
 */
function getCache<T>(key: string): T | null {
    if (!key) return null;
    const entry = cache.get(key);
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
        // console.log(`[Cache] Hit for key: ${key.substring(0,10)}...`);
        return entry.data as T;
    }
    // console.log(`[Cache] Miss or expired for key: ${key.substring(0,10)}...`);
    cache.delete(key); // Remove expired or non-existent entry
    return null;
}

// --- Core Fetching Logic ---

/**
 * Fetches data from the configured IPFS gateway with caching and retry logic.
 * @param url - The full URL to fetch from the gateway.
 * @param cacheKey - The key to use for caching (typically the CID).
 * @returns The fetched data (parsed as JSON if applicable) or null if fetch fails.
 */
async function fetchWithRetry<T>(url: string, cacheKey: string): Promise<T | null> {
    // 1. Check Cache first
    const cachedData = getCache<T>(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    console.log(`[Filecoin Service] Fetching: ${url} (Cache Key: ${cacheKey.substring(0,10)}...)`);

    // 2. Attempt Fetch with Retries
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get<T>(url, {
                timeout: REQUEST_TIMEOUT,
                // Ensure correct headers for potentially receiving JSON
                headers: {
                    'Accept': 'application/json, application/octet-stream, */*',
                    // 'User-Agent': 'KintaskBackend/1.0' // Optional: Identify your client
                 }
             });

            // Check content type for JSON if expecting it (primarily for fragments/index)
            const contentType = response.headers['content-type'];
            const isJsonExpected = url.includes(config.knowledgeBaseIndexCid || 'INVALID_CID') || cacheKey !== config.knowledgeBaseIndexCid; // Assume fragments & index are JSON

            if (isJsonExpected && (!contentType || !contentType.includes('application/json'))) {
                // Gateways sometimes return HTML error pages or non-JSON for DAG issues
                console.warn(`[Filecoin Service] Attempt ${attempt} for ${cacheKey}: Expected JSON but received Content-Type: ${contentType}. Raw data sample:`, typeof response.data === 'string' ? response.data.substring(0, 100) + '...' : typeof response.data);
                // Treat non-JSON response as an error for expected JSON content
                 throw new Error(`Expected JSON content, but received ${contentType || 'unknown content type'}`);
            }

            // Check for successful status code
            if (response.status === 200 && response.data) {
                console.log(`[Filecoin Service] Successfully fetched ${cacheKey.substring(0,10)}... (Attempt ${attempt})`);
                setCache(cacheKey, response.data); // Cache the successful response
                return response.data;
            } else {
                // Log unexpected success status codes (e.g., 204 No Content?)
                console.warn(`[Filecoin Service] Fetch attempt ${attempt} for ${cacheKey} returned unexpected status: ${response.status}`);
                // Continue to retry loop
            }

        } catch (error: any) {
            const axiosError = error as AxiosError;
            console.warn(`[Filecoin Service] Error fetch attempt ${attempt}/${MAX_RETRIES} for ${cacheKey}:`, axiosError.message);

            // Log details from the error response if available
            if (axiosError.response) {
                 console.warn(`  Gateway Response Status: ${axiosError.response.status}`);
                 // console.warn(`  Gateway Response Headers:`, axiosError.response.headers); // Can be verbose
                 // console.warn(`  Gateway Response Data:`, axiosError.response.data); // Can be verbose/large

                 // Don't retry on 404 Not Found - the content likely doesn't exist
                 if (axiosError.response.status === 404) {
                      console.error(`[Filecoin Service] CID ${cacheKey} not found on gateway (404). Stopping retries.`);
                      return null; // Indicate definitively not found
                 }
                 // Consider stopping retries on other client errors (4xx) too?
            } else if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
                console.warn(`  Gateway request timed out.`);
            }

            // If it's the last attempt, log final failure and return null
            if (attempt === MAX_RETRIES) {
                console.error(`[Filecoin Service] Final fetch attempt failed for CID: ${cacheKey} after ${MAX_RETRIES} tries.`);
                return null;
            }

            // Wait before retrying with exponential backoff
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s...
            console.log(`  Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Should not be reached if error handling above is correct, but acts as a fallback
    console.error(`[Filecoin Service] Fetch failed unexpectedly for ${cacheKey} after all attempts.`);
    return null;
}

// --- Exported Service Functions ---

/**
 * Fetches and parses the Knowledge Graph index file from Filecoin/IPFS.
 * @returns The keyword-to-CID index object, or null if fetching fails.
 */
export async function getKnowledgeIndex(): Promise<IndexFileStructure['index'] | null> {
    const indexCid = config.knowledgeBaseIndexCid;
    if (!indexCid) {
        console.error('[Filecoin Service] FATAL ERROR: KB_INDEX_CID is not configured in backend .env.');
        return null;
    }

    const url = `${IPFS_GATEWAY}${indexCid}`;
    console.log(`[Filecoin Service] Getting Knowledge Index (CID: ${indexCid.substring(0,10)}...)`);
    const indexFile = await fetchWithRetry<IndexFileStructure>(url, indexCid); // Use index CID as cache key

    if (indexFile && typeof indexFile.index === 'object' && indexFile.index !== null) {
         // Optional: Log how many keywords are in the loaded index
         console.log(`[Filecoin Service] Successfully loaded index with ${Object.keys(indexFile.index).length} keywords.`);
         return indexFile.index;
    } else {
         console.error(`[Filecoin Service] Failed to fetch or parse index file structure from CID: ${indexCid}`);
         return null;
    }
}

/**
 * Fetches and parses a single Knowledge Fragment JSON object from Filecoin/IPFS using its CID.
 * @param cid - The Content Identifier (CID) of the fragment to fetch.
 * @returns The parsed KnowledgeFragment object, or null if fetching or parsing fails.
 */
export async function fetchKnowledgeFragment(cid: string): Promise<KnowledgeFragment | null> {
    // Basic CID format validation
    if (!cid || typeof cid !== 'string' || (!cid.startsWith('bafy') && !cid.startsWith('Qm'))) {
        console.error(`[Filecoin Service] Invalid CID format provided for fragment fetch: ${cid}`);
        return null;
    }

    const url = `${IPFS_GATEWAY}${cid}`;
    // Use fragment CID as the cache key
    const fragment = await fetchWithRetry<KnowledgeFragment>(url, cid);

    // Optional: Add schema validation here after fetching if needed
    // if (fragment && !isValidKnowledgeFragment(fragment)) {
    //     console.error(`[Filecoin Service] Fetched data for CID ${cid} is not a valid KnowledgeFragment.`);
    //     return null;
    // }

    return fragment;
}

// Optional: Add a function to clear the cache if needed for debugging
export function clearFilecoinCache() {
    console.log("[Filecoin Service] Clearing in-memory cache.");
    cache.clear();
}