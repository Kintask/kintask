// kintask/scripts/upload-kg-fragments.js
import { create } from '@web3-storage/w3up-client';
import { filesFromPaths } from 'files-from-path';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import url from 'url'; // <-- Import the 'url' module

// --- Get Current Directory Path (ESM way) ---
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- End ESM Directory Path ---

// Load backend .env relative to *this script's* directory
dotenv.config({ path: path.resolve(__dirname, '../packages/backend/.env') }); 

// --- Configuration ---
const W3UP_AGENT_EMAIL = process.env.W3UP_AGENT_EMAIL;
const KINTASK_SPACE_DID = process.env.KINTASK_SPACE_DID;
// Use the derived __dirname to resolve paths relative to the script
const FRAGMENTS_DIR = path.resolve(__dirname, 'knowledge_fragments');
const INDEX_FILE_PATH = path.resolve(__dirname, 'kg_index.json');
// --- End Configuration ---

// --- Validation ---
if (!W3UP_AGENT_EMAIL) {
    console.error("\nFATAL ERROR: W3UP_AGENT_EMAIL not found in packages/backend/.env");
    process.exit(1);
}
if (!KINTASK_SPACE_DID || !KINTASK_SPACE_DID.startsWith('did:key:')) {
    console.error("\nFATAL ERROR: KINTASK_SPACE_DID not found or invalid in packages/backend/.env");
    process.exit(1);
}
// --- End Validation ---

/**
 * Initializes the w3up client, logs in the agent, and sets the target space.
 * @returns {Promise<Object>} Initialized and configured w3up client.
 */
async function initializeW3upClient() {
    console.log("Initializing w3up client...");
    const client = await create();
    console.log(`Client Agent DID: ${client.did()}`);

    // Check if agent is already logged in locally
    const currentAccount = client.accounts()[W3UP_AGENT_EMAIL];
    if (currentAccount && !currentAccount.disconnected) {
        console.log(`Agent already logged in as ${W3UP_AGENT_EMAIL}`);
    } else {
        console.log(`Logging in agent ${W3UP_AGENT_EMAIL}...`);
        console.log("Please check your email for the verification link and click it.");
        try {
            await client.login(W3UP_AGENT_EMAIL);
            console.log("Agent login successful!");
            // Optional: Wait for payment plan confirmation if needed right after login
            // console.log("Waiting for payment plan confirmation (if needed)...");
            // await client.accounts()[W3UP_AGENT_EMAIL].plan.wait(); // Added timeout?
            // console.log("Payment plan confirmed.");
        } catch (error) {
            console.error("\nLogin failed. Did you click the email link within the time limit?", error.message);
            process.exit(1);
        }
    }

    // Set the target space for uploads
    try {
        console.log(`Setting current space to ${KINTASK_SPACE_DID}...`);
        await client.setCurrentSpace(KINTASK_SPACE_DID);
        const currentSpace = client.currentSpace();
        if (currentSpace?.did() !== KINTASK_SPACE_DID) {
            throw new Error(`Failed to set current space correctly. Current: ${currentSpace?.did()}`);
        }
        console.log(`Successfully set current space: ${client.currentSpace()?.did()}`);
    } catch (error) {
        console.error(`\nError setting space ${KINTASK_SPACE_DID}: ${error.message}`);
        console.error("Please ensure the Space DID is correct and the agent has access.");
        process.exit(1);
    }

    return client;
}

/**
 * Uploads a directory of fragment files and the generated index file.
 * @param {Object} client Initialized w3up client.
 */
async function uploadKnowledgeGraph(client) {
    console.log(`\nReading fragments from directory: ${FRAGMENTS_DIR}`);
    let processedFiles = 0;
    let skippedFiles = 0;
    const fragmentsToUpload = [];
    const uploadedFragmentsMap = new Map();
    const keywordIndex = {};

    try {
        const filenames = await fs.readdir(FRAGMENTS_DIR);
        console.log(`Found ${filenames.length} potential fragment files.`);

        // --- Prepare Fragment Files for Upload ---
        for (const filename of filenames) {
            if (path.extname(filename).toLowerCase() === '.json') {
                processedFiles++;
                const filePath = path.join(FRAGMENTS_DIR, filename);
                console.log(`\nProcessing file [${processedFiles}/${filenames.length}]: ${filename}`);
                try {
                    const fileContentRaw = await fs.readFile(filePath, 'utf-8');
                    const fragmentData = JSON.parse(fileContentRaw);

                    // Validation
                    if (!fragmentData.fragment_id || typeof fragmentData.fragment_id !== 'string' || fragmentData.fragment_id.trim() === '') {
                        console.log(`   Skipping file ${filename}: invalid fragment_id`);
                        skippedFiles++;
                        continue;
                    }
                    const fragmentId = fragmentData.fragment_id.trim();
                    if (!fragmentData.content || typeof fragmentData.content !== 'object') {
                        console.log(`   Skipping file ${filename}: missing or invalid content`);
                        skippedFiles++;
                        continue;
                    }
                    if (!fragmentData.provenance || typeof fragmentData.provenance !== 'object') {
                        console.log(`   Skipping file ${filename}: missing or invalid provenance`);
                        skippedFiles++;
                        continue;
                    }
                    if (uploadedFragmentsMap.has(fragmentId)) {
                        console.log(`   Skipping file ${filename}: duplicate fragment_id ${fragmentId}`);
                        skippedFiles++;
                        continue;
                    }

                    // Create File object for upload
                    const fileObject = new File([fileContentRaw], `${fragmentId}.json`, { type: 'application/json' });
                    fragmentsToUpload.push({ file: fileObject, fragmentId: fragmentId, keywords: fragmentData.keywords || [] });
                    console.log(`   Prepared fragment ${fragmentId} for upload.`);
                } catch (parseError) {
                    console.error(`   ⛔ Error parsing JSON in ${filename}:`, parseError.message);
                    skippedFiles++;
                }
            } else {
                console.log(`   Skipping non-JSON file: ${filename}`);
                skippedFiles++;
            }
        } // End file loop

        console.log(`\n--- Preparation Summary ---`);
        console.log(`   Processed: ${processedFiles} files`);
        console.log(`   Skipped: ${skippedFiles} files`);
        console.log(`   Prepared for Upload: ${fragmentsToUpload.length} fragments`);

        if (fragmentsToUpload.length === 0) {
            console.error("\nERROR: No valid fragments prepared for upload.");
            process.exit(1);
        }

        // --- Perform Batch Upload of Fragments (as Directory) ---
        console.log(`\nUploading ${fragmentsToUpload.length} fragments as a directory...`);
        const fragmentFiles = fragmentsToUpload.map(f => f.file);
        const fragmentsDirectoryCid = await client.uploadDirectory(fragmentFiles);
        console.log(`   ✅ Fragments directory uploaded! Root CID: ${fragmentsDirectoryCid}`);

        // --- Determine Individual Fragment CIDs & Build Index ---
        console.log(`\nRe-uploading fragments individually to confirm CIDs and build index...`);
        let individualUploadCount = 0;
        for (const item of fragmentsToUpload) {
            try {
                console.log(`   Uploading individual file: ${item.file.name}`);
                // Re-uploading individually ensures we get the CID for this specific content
                const individualCid = await client.uploadFile(item.file);
                console.log(`     -> Individual CID: ${individualCid}`);
                uploadedFragmentsMap.set(item.fragmentId, individualCid.toString());
                individualUploadCount++;

                // Indexing
                if (item.keywords && Array.isArray(item.keywords)) {
                    item.keywords.forEach(keyword => {
                        if (typeof keyword === 'string' && keyword.trim() !== '') {
                            const lowerKeyword = keyword.toLowerCase().trim();
                            if (!keywordIndex[lowerKeyword]) keywordIndex[lowerKeyword] = [];
                            if (!keywordIndex[lowerKeyword].includes(individualCid.toString())) {
                                keywordIndex[lowerKeyword].push(individualCid.toString());
                            }
                        }
                    });
                }
            } catch (individualUploadError) {
                console.error(`   ⛔ Failed to re-upload/get CID for ${item.file.name} (Fragment ID: ${item.fragmentId}):`, individualUploadError.message);
            }
        }
        console.log(`Confirmed CIDs for ${individualUploadCount} fragments.`);
        if (individualUploadCount === 0) throw new Error("Failed to get any individual fragment CIDs.");

        // --- Generate & Upload Index File ---
        console.log("\nGenerating index file...");
        const indexData = {
            createdAt: new Date().toISOString(),
            description: `Kintask Knowledge Graph Index via w3up/Storacha. Maps keywords to IPFS CIDs. Root dir CID: ${fragmentsDirectoryCid}. Based on ${individualUploadCount} fragments.`,
            indexRootCid: fragmentsDirectoryCid.toString(),
            fragmentsById: Object.fromEntries(uploadedFragmentsMap),
            index: keywordIndex
        };
        const indexJson = JSON.stringify(indexData, null, 2);
        const indexFileObject = new File([indexJson], "kg_index.json", { type: 'application/json' });

        console.log("Uploading the generated index file...");
        const indexCid = await client.uploadFile(indexFileObject);
        console.log(`   ✅ Index file uploaded! CID: ${indexCid}`);

        // --- Final Output ---
        console.log(`\n---------------------------------------------------------------------`);
        console.log(`\n✅ Successfully Uploaded Index File -> CID: ${indexCid}`);
        console.log(`   (Fragments Root Directory CID: ${fragmentsDirectoryCid})`);
        console.log(`\nACTION REQUIRED:`);
        console.log(`  1. Copy the Index File CID above (${indexCid}).`);
        console.log(`  2. Paste it into the KB_INDEX_CID variable in packages/backend/.env`);
        console.log(`\n---------------------------------------------------------------------`);

    } catch (error) {
        console.error('\nSCRIPT FAILED:', error.message, error.stack);
        process.exit(1);
    }
}

// --- Main Execution ---
async function main() {
    const client = await initializeW3upClient();
    await uploadKnowledgeGraph(client);
}

main().catch(err => {
    console.error("Unhandled error in main execution:", err);
    process.exit(1);
});
