// scripts/agents/agentUtils.js (Simulate generate-car Output Structure)
import { CarWriter } from '@ipld/car/writer';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
// import * as dagPb from '@ipld/dag-pb';
import { MemoryBlockstore } from 'blockstore-core/memory';
// import * as Block from '@ipfs/blocks';
import  * as jsonCodec  from 'multiformats/codecs/json';
import { ethers } from 'ethers';
import crypto from 'crypto'; // For basic hashing in simulation

/**
 * Creates CAR buffer and SIMULATES output needed for deal proposal,
 * mimicking what 'generate-car' would provide.
 * Returns CAR buffer, DataCID (Label), SIMULATED PieceCID, SIMULATED PieceSize, CAR size.
 */
export async function createEvidenceCar(dataObject, fileName = 'evidence.json') {
    console.log(`[Agent Utils - Sim GC] Creating CAR for data:`, JSON.stringify(dataObject).substring(0, 100) + '...');
    const blockstore = new MemoryBlockstore();

    try {
        // 1. Encode data and get block/CID
        const valueBytes = jsonCodec.encode(dataObject);
        const hash = await sha256.digest(valueBytes);
        const dataCidInstance = CID.create(1, jsonCodec.code, hash); // DataCID / Label
        const dataCidString = dataCidInstance.toString();
        console.log(`[Agent Utils - Sim GC] Calculated DataCID (Label): ${dataCidString}`);
         blockstore.put(dataCidInstance, valueBytes);

        // 2. Create CAR writer & Write block
        const { writer, out } = CarWriter.create([dataCidInstance]);
        const storedBlockBytes = await blockstore.get(dataCidInstance);
        if (!storedBlockBytes) { throw new Error(`Block bytes not found for CID ${dataCidInstance}`); }
         writer.put({ cid: dataCidInstance, bytes: storedBlockBytes });
         writer.close();

        // 3. Collect CAR buffer
        const carBufferChunks = [];
        for await (const chunk of out) { carBufferChunks.push(chunk); }
        const carBuffer = Buffer.concat(carBufferChunks);
        const carSize = carBuffer.length; // Real CAR Size
        console.log(`[Agent Utils - Sim GC] CAR buffer created. Size: ${carSize} bytes`);

        // --- PieceCID / PieceSize Simulation (Mimicking generate-car output format) ---
        const fakePieceSeed = crypto.randomBytes(20).toString('hex'); // Generate some randomness
        // Create a plausible *string* representation (like baga...)
        const pieceCidString = `baga${fakePieceSeed}${dataCidString.substring(4, 14)}`;
        // Calculate plausible piece size (power of 2 >= carSize, min 256)
        let pieceSize = 256;
        while (pieceSize < carSize) { pieceSize *= 2; }
        console.warn(`[Agent Utils - Sim GC] *** SIMULATED PieceCID String: ${pieceCidString} ***`);
        console.warn(`[Agent Utils - Sim GC] *** SIMULATED PieceSize: ${pieceSize} ***`);
        // --- End Simulation ---

        return {
            carBuffer,                  // The raw CAR data buffer
            dataCid: dataCidString,     // Label/DataCID as string
            pieceCid: pieceCidString,   // SIMULATED PieceCID as string
            pieceSize: pieceSize,       // SIMULATED PieceSize as number
            carSize: carSize            // Correct CAR Size as number
        };

    } catch (error) {
        console.error("[Agent Utils - Sim GC] Error during CAR creation:", error);
        throw new Error(`Failed CAR creation: ${error.message}`);
    } finally {
        if (typeof blockstore.close === 'function') { await blockstore.close().catch(e => console.error("Error closing blockstore:", e)); }
    }
}

// --- Upload Simulation ---
export async function uploadCarFile(carBuffer, fileName = 'evidence.car') {
    console.log(`[Agent Utils] Simulating upload of ${fileName} (${carBuffer.length} bytes)...`);
    const bufferHash = ethers.utils.sha256(carBuffer).substring(2, 12);
    const placeholderUrl = `https://placeholder-car-link.io/simulated/${bufferHash}/${fileName}`;
    console.log(`[Agent Utils] Simulated Upload URL: ${placeholderUrl}`);
    return placeholderUrl; // Return placeholder URL
}

// --- REMOVED makeOffChainDeal simulation ---

// --- Other Utils ---
export function truncateText(text, maxLength) { /* ... */ if (!text) return ''; if (text.length <= maxLength) return text; return text.substring(0, maxLength - 3) + '...'; }
export function hashData(data) { /* ... */ if (typeof data !== 'string') { data = String(data); } return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data)); }
export function hashToBigInt(hash) { /* ... */ return BigInt(hash); }