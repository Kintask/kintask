// ./packages/backend/src/services/filecoinService.ts
import axios, { AxiosError } from 'axios';
import config from '../config';
import { truncateText } from '../utils';

const IPFS_GATEWAY = config.ipfsGatewayUrl || 'https://w3s.link/ipfs/';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;
const REQUEST_TIMEOUT = 25000;

console.log(`[Filecoin Service] Using IPFS Gateway: ${IPFS_GATEWAY}`);
interface CacheEntry<T> { data: T; timestamp: number; }
const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 10 * 60 * 1000;
function setCache<T>(key: string, data: T) { if (!key) return; cache.set(key, { data, timestamp: Date.now() }); }
function getCache<T>(key: string): T | null { if (!key) return null; const entry = cache.get(key); if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) { return entry.data as T; } cache.delete(key); return null; }

async function fetchWithRetry(url: string, cacheKey: string): Promise<string | null> {
    const cachedData = getCache<string>(cacheKey);
    if (cachedData) { console.log(`[Filecoin Service DEBUG] Cache HIT for ${cacheKey.substring(0,10)}...`); return cachedData; }
    console.log(`[Filecoin Service] Fetching: ${url.substring(0, 60)}... (Key: ${cacheKey.substring(0,10)}...)`);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get<string>(url, { timeout: REQUEST_TIMEOUT, responseType: 'text', headers: { 'Accept': 'text/plain, */*' } });
            if (response.status === 200 && typeof response.data === 'string') {
                setCache(cacheKey, response.data); console.log(`[Filecoin Service DEBUG] Fetched content OK (len: ${response.data.length})`); console.log(`[Filecoin Service DEBUG] Content sample: ${truncateText(response.data, 300)}`); return response.data;
            } else { console.warn(`[Filecoin Service] Fetch attempt ${attempt} status: ${response.status}, type: ${typeof response.data}`); }
        } catch (error: any) { const axiosError = error as AxiosError; const conciseError = axiosError.message.split('\n')[0]; console.warn(`[Filecoin Service] Fetch Error ${attempt}/${MAX_RETRIES}: ${conciseError}`); if (axiosError.response?.status === 404) { console.error(`[Filecoin Service] CID ${cacheKey.substring(0,10)}... 404 Not Found.`); return null; } if (attempt === MAX_RETRIES) { console.error(`[Filecoin Service] Final fetch attempt failed: ${cacheKey.substring(0,10)}...`); return null; } const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); await new Promise(resolve => setTimeout(resolve, delay)); }
    }
    console.error(`[Filecoin Service] Fetch failed unexpectedly: ${cacheKey.substring(0,10)}...`); return null;
}

export async function fetchKnowledgeSourceContent(): Promise<string | null> {
    const sourceCid = config.knowledgeBaseIndexCid;
    if (!sourceCid) { console.error('[Filecoin Service] Error: KB_INDEX_CID not configured.'); return null; }
    if (typeof sourceCid !== 'string' || sourceCid.trim() === '' || (!sourceCid.startsWith('bafy') && !sourceCid.startsWith('bafk') && !sourceCid.startsWith('Qm'))) { console.error(`[Filecoin Service] Invalid KB_INDEX_CID format: ${sourceCid}`); return null; }
    const url = `${IPFS_GATEWAY}${sourceCid}`; console.log(`[Filecoin Service] Fetching Knowledge Source (CID: ${sourceCid.substring(0,10)}...)`);
    return await fetchWithRetry(url, sourceCid);
}

export function clearFilecoinCache() { console.log("[Filecoin Service] Clearing cache."); cache.clear(); }