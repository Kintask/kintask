import axios, { AxiosError, AxiosResponse } from 'axios';
import config from '../config';
import { KnowledgeFragment } from '../types';
import { setTimeout } from 'timers/promises'; // Use promise-based setTimeout

// Use a reliable public IPFS gateway. Consider fallbacks or dedicated gateway for production.
const IPFS_GATEWAY = 'https://w3s.link/ipfs/';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // Start delay 1s
const REQUEST_TIMEOUT = 25000; // 25 seconds timeout

// Define structure expected in the index file uploaded to Filecoin
interface IndexFileStructure {
    createdAt: string;
    description?: string;
    fragmentsById?: Record<string, string>; // fragment_id -> cid map (optional but good)
    index: Record<string, string[]>; // keyword -> [cid] map
}

// Simple in-memory cache with TTL (Time To Live) in milliseconds
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    cid: string; // Store CID for potential validation
}
const cache = new Map<string, CacheEntry<any>>(); // Key is CID
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache validity
const MAX_CACHE_SIZE = 500; // Limit cache size

// Utility to manage cache
function setCache<T>(cid: string, data: T) {
    if (!cid) return;
    if (cache.size >= MAX_CACHE_SIZE) {
        // Evict oldest entry if cache is full
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
        console.log(`[Cache] Evicted oldest entry: ${oldestKey?.substring(0,10)}...`);
    }
    cache.set(cid, { data, timestamp: Date.now(), cid });
    // console.log(`[Cache] Set entry for CID: ${cid.substring(0,10)}...`);
}

function getCache<T>(cid: string): T | null {
    if (!cid) return null;
    const entry = cache.get(cid);
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
        // console.log(`[Cache] Hit for CID: ${cid.substring(0,10)}...`);
        return entry.data as T;
    }
    if (entry) {
        // console.log(`[Cache] Stale entry for CID: ${cid.substring(0,10)}...`);
        cache.delete(cid); // Remove stale entry
    }
    return null;
}

// Generic fetch function with retry logic
async function fetchWithRetry<T>(url: string, cid: string): Promise<T | null> {
    const cachedData = getCache<T>(cid);
    if (cachedData) {
        return cachedData;
    }

    console.log(`[Filecoin Service] Fetching CID ${cid.substring(0, 10)}... via ${url}`);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response: AxiosResponse<T> = await axios.get<T>(url, {
                timeout: REQUEST_TIMEOUT,
                // Explicitly accept JSON, but be ready for gateway errors
                headers: { 'Accept': 'application/json, */*' }
             });

            // Check for non-JSON responses that might indicate gateway errors or wrong content type
            const contentType = response.headers['content-type'];
            if (!contentType || !contentType.toLowerCase().includes('application/json')) {
                // Handle common gateway error pages (often HTML)
                if (contentType?.toLowerCase().includes('text/html')) {
                     console.warn(`[Filecoin Service] Attempt ${attempt} for ${cid}: Received HTML (likely gateway error page), status ${response.status}`);
                } else {
                     console.warn(`[Filecoin Service] Attempt ${attempt} for ${cid}: Received non-JSON content type: ${contentType}, status ${response.status}`);
                }
                 // Treat non-JSON as potentially retryable unless it's a definitive error like 404
                 if (response.status === 404) {
                     console.error(`[Filecoin Service] CID ${cid} not found (404) via gateway. Stopping retries.`);
                     return null; // Explicitly return null for not found
                 }
                 // Throw an error to trigger retry logic for other non-JSON cases
                 throw new Error(`Expected JSON, received ${contentType || 'unknown content type'}`);
             }

            // Handle successful JSON response
            if (response.status === 200 && response.data) {
                console.log(`[Filecoin Service] Successfully fetched CID ${cid.substring(0, 10)}...`);
                setCache(cid, response.data); // Cache successful fetch
                // Add CID to the fetched object if it's an object and doesn't have it
                if (typeof response.data === 'object' && response.data !== null && !(response.data as any).cid) {
                    try {
                         (response.data as any).cid = cid;
                    } catch (e) { /* Object might be frozen, ignore */ }
                }
                return response.data;
            } else {
                // Log unexpected success status codes if they have JSON bodies
                console.warn(`[Filecoin Service] Fetch attempt ${attempt} for ${cid} returned unexpected JSON status: ${response.status}`);
                // Throw to retry unless it's a status code that shouldn't be retried (e.g., 4xx client errors other than 404 handled above)
                if (response.status >= 400 && response.status < 500) {
                     console.error(`[Filecoin Service] Client error status ${response.status} for ${cid}. Stopping retries.`);
                     return null;
                }
                 throw new Error(`Unexpected status code ${response.status}`);
            }

        } catch (error: any) {
            const axiosError = error as AxiosError;
            let shouldRetry = true;
            let errorMsg = axiosError.message;

            if (axiosError.response) {
                // Got a response from the server, but it's an error status code
                errorMsg = `Gateway Response Status: ${axiosError.response.status} for CID ${cid.substring(0, 10)}`;
                console.warn(`[Filecoin Service] Attempt ${attempt} failed: ${errorMsg}`);
                 // Stop retrying on 404 Not Found specifically
                if (axiosError.response.status === 404) {
                     console.error(`[Filecoin Service] CID ${cid} not found on gateway (404). Stopping retries.`);
                     shouldRetry = false;
                     return null; // Explicitly return null for not found
                }
                // Consider stopping on other 4xx errors too? Maybe allow retry for rate limits (429)?
                if (axiosError.response.status >= 400 && axiosError.response.status < 500 && axiosError.response.status !== 429) {
                    console.error(`[Filecoin Service] Client error ${axiosError.response.status} for ${cid}. Stopping retries.`);
                    shouldRetry = false;
                    return null; // Return null for client errors other than rate limits
                }
            } else if (axiosError.request) {
                // Request was made but no response received (timeout, network error)
                errorMsg = `Network error or timeout for CID ${cid.substring(0, 10)}`;
                console.warn(`[Filecoin Service] Attempt ${attempt} failed: ${errorMsg}. (${axiosError.code || 'No Code'})`);
                // Generally retry network errors/timeouts
            } else {
                // Setup error or other issue
                errorMsg = `Error setting up request for CID ${cid.substring(0, 10)}`;
                console.warn(`[Filecoin Service] Attempt ${attempt} failed: ${errorMsg}: ${axiosError.message}`);
                shouldRetry = false; // Don't retry setup errors
                return null;
            }

            if (attempt === MAX_RETRIES || !shouldRetry) {
                console.error(`[Filecoin Service] Final fetch attempt failed for CID: ${cid}. Error: ${errorMsg}`);
                return null; // Return null after final attempt or if retry is disallowed
            }

            // Implement exponential backoff
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`   Retrying CID ${cid.substring(0, 10)} in ${delay}ms...`);
            await setTimeout(delay); // Use promise-based timeout
        }
    }
    // Should only be reached if all retries fail in an unexpected way
    console.error(`[Filecoin Service] Fetch failed for CID ${cid} after all retries.`);
    return null;
}

// --- Public Service Functions ---

// Fetches the index file containing keyword-to-CID mappings
export async function getKnowledgeIndex(): Promise<IndexFileStructure['index'] | null> {
    const indexCid = config.knowledgeBaseIndexCid;
    if (!indexCid || indexCid === 'PASTE_INDEX_CID_HERE') {
        console.error('[Filecoin Service] KB_INDEX_CID is not configured or is placeholder in backend .env.');
        return null;
    }

    const url = `${IPFS_GATEWAY}${indexCid}`;
    const indexFile = await fetchWithRetry<IndexFileStructure>(url, indexCid); // Use index CID

    if (indexFile && typeof indexFile.index === 'object' && indexFile.index !== null) {
         console.log(`[Filecoin Service] Knowledge index loaded successfully (${Object.keys(indexFile.index).length} keywords).`);
         return indexFile.index;
    } else {
         console.error(`[Filecoin Service] Failed to fetch or parse index file structure from CID: ${indexCid}`);
         return null;
    }
}

// Fetches a single knowledge fragment JSON object using its CID
export async function fetchKnowledgeFragment(cid: string): Promise<KnowledgeFragment | null> {
    // Basic CID format validation (improve if needed for different CID versions)
    if (!cid || typeof cid !== 'string' || !cid.match(/^(Qm[a-zA-Z0-9]{44}|bafy[a-zA-Z0-9]{55})$/)) {
        console.error(`[Filecoin Service] Invalid CID format provided for fragment fetch: ${cid}`);
        return null;
    }

    const url = `${IPFS_GATEWAY}${cid}`;
    const fragment = await fetchWithRetry<KnowledgeFragment>(url, cid);

    // Optional: Validate fetched fragment against KnowledgeFragment interface/schema
    if (fragment) {
        if (typeof fragment.fragment_id !== 'string' || typeof fragment.type !== 'string' || typeof fragment.content !== 'object' || typeof fragment.provenance !== 'object') {
             console.warn(`[Filecoin Service] Fetched fragment ${cid} has missing/invalid core fields.`);
             // Decide whether to return potentially invalid data or null
             // return null;
        }
         // Add CID if fetchWithRetry didn't already
        if (!fragment.cid) fragment.cid = cid;
    }

    return fragment;
}
