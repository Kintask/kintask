// scripts/agents/agentUtils.js (Fixed CAR Write + Timeout)
import { CarWriter } from '@ipld/car/writer';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as dagPb from '@ipld/dag-pb';
import { MemoryBlockstore } from 'blockstore-core/memory';
// import * as Block from '@ipfs/blocks'; // Keep this if @ipld/block/defaults is removed/deprecated
import  * as jsonCodec  from 'multiformats/codecs/json';
import { ethers } from 'ethers';

/**
 * Creates a CAR file in memory using blockstore-core/memory.
 * Includes timeout for collecting chunks from the CAR writer stream.
 * Returns the CAR file buffer, the root DataCID (label), PieceCID, and PieceSize.
 * NOTE: PieceCID/PieceSize calculation here is a basic simulation.
 */
export async function createEvidenceCar(dataObject, fileName = 'evidence.json') {
    console.log(`[Agent Utils - Core] Creating CAR for data:`, JSON.stringify(dataObject).substring(0, 100) + '...');
    const blockstore = new MemoryBlockstore();

    try {
        // 1. Encode data and get CID
        console.log('[Agent Utils - Core] Encoding data with DAG-JSON codec...');
        const valueBytes = jsonCodec.encode(dataObject);
        const hash = await sha256.digest(valueBytes);
        const rootCid = CID.create(1, jsonCodec.code, hash);
        console.log(`[Agent Utils - Core] Calculated Block CID (DataCID/Label): ${rootCid.toString()}`);

        // 2. Put bytes into blockstore
        console.log('[Agent Utils - Core] Storing block bytes in blockstore...');
        await blockstore.put(rootCid, valueBytes);
        console.log('[Agent Utils - Core] Block stored.');

        // 3. Create CAR writer
        const { writer, out } = CarWriter.create([rootCid]);

        // 4. Get block bytes and write to CAR writer
        console.log('[Agent Utils - Core] Getting block and writing to CAR...');
        const storedBlockBytes = await blockstore.get(rootCid);
        if (!storedBlockBytes) {
             throw new Error(`Block bytes not found in blockstore for CID ${rootCid}`);
        }
        writer.put({ cid: rootCid, bytes: storedBlockBytes });
        console.log(`[Agent Utils - Core] Block written to CAR writer.`);

        // 5. Close the writer BEFORE reading the output stream
        console.log('[Agent Utils - Core] Closing CAR writer...');
        writer.close();
        console.log('[Agent Utils - Core] CAR writer closed.');

        // 6. Collect CAR buffer chunks with a timeout
        console.log('[Agent Utils - Core] Collecting CAR buffer chunks...');
        const timeoutMs = 5000; // 5 second timeout for chunk collection
        const carBufferChunks = [];
        let timeoutReached = false;

        const chunkPromise = (async () => {
            for await (const chunk of out) {
                if (timeoutReached) break; // Stop processing if timeout hits
                carBufferChunks.push(chunk);
            }
        })();

        const timeoutHandle = setTimeout(() => {
             timeoutReached = true;
             console.error('[Agent Utils - Core] CAR chunk collection timed out!');
        }, timeoutMs);

        try {
             await chunkPromise; // Wait for chunk collection or timeout
        } catch (collectError){
            // Handle potential errors during chunk collection itself if any
             console.error('[Agent Utils - Core] Error during chunk collection:', collectError);
             clearTimeout(timeoutHandle); // Clear timeout if collection errors
             throw collectError; // Re-throw collection error
        }

        clearTimeout(timeoutHandle); // Clear timeout if collection finished normally

        if (timeoutReached) {
             throw new Error("CAR chunk collection timed out");
        }

        const carBuffer = Buffer.concat(carBufferChunks);
        const carSize = carBuffer.length;
        console.log(`[Agent Utils - Core] CAR buffer created. Size: ${carSize} bytes`);

        if (carSize === 0) {
            console.warn("[Agent Utils - Core] Warning: Created empty CAR buffer.");
        }

        // --- PieceCID / PieceSize Simulation ---
        const pieceCIDPlaceholder = CID.create(1, dagPb.code, await sha256.digest(carBuffer));
        const pieceSizePlaceholder = 2048;
        console.warn(`[Agent Utils - Core] *** SIMULATED PieceCID: ${pieceCIDPlaceholder.toString()} ***`);
        console.warn(`[Agent Utils - Core] *** SIMULATED PieceSize: ${pieceSizePlaceholder} ***`);
        // --- End Simulation ---

        return { carBuffer, dataCid: rootCid.toString(), pieceCid: pieceCIDPlaceholder.toString(), pieceSize: pieceSizePlaceholder, carSize };

    } catch (error) {
        console.error("[Agent Utils - Core] Error during CAR creation:", error);
        throw new Error(`Failed CAR creation: ${error.message}`);
    } finally {
        if (typeof blockstore.close === 'function') {
             await blockstore.close().catch(e => console.error("Error closing blockstore:", e));
        }
    }
}

// ... rest of agentUtils.js remains the same ...
export async function uploadCarFile(carBuffer, fileName = 'evidence.car') { /* ... no change ... */ console.log(`[Agent Utils] Simulating upload of ${fileName} (${carBuffer.length} bytes)...`); const bufferHash = ethers.utils.sha256(carBuffer).substring(2, 12); const placeholderUrl = `https://placeholder-car-link.io/simulated/${bufferHash}/${fileName}`; console.log(`[Agent Utils] Simulated Upload URL: ${placeholderUrl}`); return placeholderUrl; }
export async function makeOffChainDeal(pieceCid, pieceSize, dataCid) { /* ... no change ... */ console.log(`[Agent Utils] Simulating off-chain deal making...`); console.log(`  PieceCID: ${pieceCid}`); console.log(`  PieceSize: ${pieceSize}`); console.log(`  DataCID (Label): ${dataCid}`); const fakeDealId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 100000); console.log(`[Agent Utils] *** SIMULATED Deal ID: ${fakeDealId} ***`); return fakeDealId; }
export function truncateText(text, maxLength) { /* ... no change ... */ if (!text) return ''; if (text.length <= maxLength) return text; return text.substring(0, maxLength - 3) + '...'; }
export function hashData(data) { /* ... no change ... */ if (typeof data !== 'string') { console.warn("[Agent Utils] Hashing non-string data:", typeof data); data = String(data); } return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data)); }
export function hashToBigInt(hash) { /* ... no change ... */ return BigInt(hash); }

