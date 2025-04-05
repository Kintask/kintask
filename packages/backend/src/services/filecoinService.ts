// ./packages/backend/src/services/filecoinService.ts
import axios, { AxiosError } from 'axios';
import config from '../config';
import { truncateText, isValidCid } from '../utils'; // Import isValidCid

const IPFS_GATEWAY = config.ipfsGatewayUrl || 'https://w3s.link/ipfs/';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;
const REQUEST_TIMEOUT = 25000; // 25 seconds

console.log(`[Filecoin Service] Using IPFS Gateway: ${IPFS_GATEWAY}`);
interface CacheEntry<T> { data: T; timestamp: number; }
const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
function setCache<T>(key: string, data: T) { if (!key) return; cache.set(key, { data, timestamp: Date.now() }); }
function getCache<T>(key: string): T | null { if (!key) return null; const entry = cache.get(key); if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) { /* console.log(`[Filecoin Service DEBUG] Cache HIT for ${key.substring(0,10)}...`); */ return entry.data as T; } cache.delete(key); return null; }

async function fetchWithRetry(url: string, cacheKey: string): Promise<string | null> {
    const cachedData = getCache<string>(cacheKey);
    if (cachedData) { return cachedData; }
    console.log(`[Filecoin Service] Fetching: ${url.substring(0, 60)}... (Key: ${cacheKey.substring(0,10)}...)`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get<string>(url, {
                 timeout: REQUEST_TIMEOUT,
                 responseType: 'text', // Ensure we get text
                 headers: { 'Accept': 'text/plain, */*' } // Prefer plain text
             });
            if (response.status === 200 && typeof response.data === 'string' && response.data.length > 0) {
                setCache(cacheKey, response.data);
                console.log(`[Filecoin Service DEBUG] Fetched content OK (len: ${response.data.length}) Key: ${cacheKey.substring(0,10)}...`);
                // console.log(`[Filecoin Service DEBUG] Content sample: ${truncateText(response.data, 300)}`); // Optionally log sample
                return response.data;
            } else {
                 console.warn(`[Filecoin Service] Fetch attempt ${attempt} status: ${response.status}, type: ${typeof response.data} for ${cacheKey.substring(0,10)}...`);
            }
        } catch (error: any) {
            const axiosError = error as AxiosError;
            const conciseError = axiosError.message.split('\n')[0];
            console.warn(`[Filecoin Service] Fetch Error ${attempt}/${MAX_RETRIES} for ${cacheKey.substring(0,10)}...: ${conciseError}`);
            if (axiosError.response?.status === 404) {
                 console.error(`[Filecoin Service] CID ${cacheKey.substring(0,10)}... 404 Not Found.`);
                 return null; // 404 is a definitive failure
            }
            if (attempt === MAX_RETRIES) {
                 console.error(`[Filecoin Service] Final fetch attempt failed for CID ${cacheKey.substring(0,10)}...`);
                 return null;
            }
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    console.error(`[Filecoin Service] Fetch failed unexpectedly for CID ${cacheKey.substring(0,10)}...`);
    return null; // Should not be reached, but belt-and-suspenders
}

// New function to fetch content by CID
export async function fetchContentByCid(cid: string): Promise<string | null> {
    if (!cid || !isValidCid(cid)) {
        console.error(`[Filecoin Service] Invalid CID provided: ${cid}`);
        return null;
    }
    const url = `${IPFS_GATEWAY}${cid}`;
    console.log(`[Filecoin Service] Fetching content for CID: ${cid.substring(0,10)}...`);
    return await fetchWithRetry(url, cid);
}


// Optional: Keep or remove this based on whether static CID config is ever needed
// export async function fetchKnowledgeSourceContent(): Promise<string | null> {
//     const sourceCid = config.knowledgeBaseIndexCid;
//     if (!sourceCid) { console.error('[Filecoin Service] Error: KB_INDEX_CID not configured.'); return null; }
//     if (!isValidCid(sourceCid)) { console.error(`[Filecoin Service] Invalid KB_INDEX_CID format in config: ${sourceCid}`); return null; }
//     const url = `${IPFS_GATEWAY}${sourceCid}`; console.log(`[Filecoin Service] Fetching Knowledge Source (CID: ${sourceCid.substring(0,10)}...)`);
//     return await fetchWithRetry(url, sourceCid);
// }

export function clearFilecoinCache() { console.log("[Filecoin Service] Clearing cache."); cache.clear(); }