// kintask/scripts/upload-paper.js
import { create } from '@web3-storage/w3up-client';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import url from 'url';
import { File } from '@web-std/file'; // Import File constructor explicitly

// Get Current Directory Path (ESM way)
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend .env relative to this script's directory
// Make sure the .env path is correct relative to THIS script file
dotenv.config({ path: path.resolve(__dirname, '../packages/backend/.env') });

// Configuration
const W3UP_AGENT_EMAIL = process.env.W3UP_AGENT_EMAIL;
const KINTASK_SPACE_DID = process.env.KINTASK_SPACE_DID;
const PAPER_FILE_PATH = path.resolve(__dirname, 'knowledge_source/paper.txt'); // ADJUST FILENAME if needed

// Validation
if (!W3UP_AGENT_EMAIL) {
    console.error("\nFATAL ERROR: W3UP_AGENT_EMAIL not configured in packages/backend/.env");
    process.exit(1);
}
if (!KINTASK_SPACE_DID || !KINTASK_SPACE_DID.startsWith('did:key:')) {
    console.error("\nFATAL ERROR: KINTASK_SPACE_DID invalid in packages/backend/.env");
    process.exit(1);
}

/**
 * Initializes the w3up client, logs in the agent, and sets the target space.
 */
async function initializeW3upClient() {
    console.log("Initializing w3up client...");
    const client = await create();
    console.log(`Client Agent DID: ${client.did()}`);

    const currentAccount = client.accounts()[W3UP_AGENT_EMAIL];
    if (currentAccount && !currentAccount.disconnected) {
        console.log(`Agent already logged in as ${W3UP_AGENT_EMAIL}`);
    } else {
        console.log(`Logging in agent ${W3UP_AGENT_EMAIL}...`);
        console.log("Please check your email for the verification link and click it.");
        try {
            await client.login(W3UP_AGENT_EMAIL);
            console.log("Agent login successful!");
        } catch (error) {
            console.error("\nLogin failed.", error.message);
            process.exit(1);
        }
    }

    try {
        console.log(`Setting current space to ${KINTASK_SPACE_DID}...`);
        await client.setCurrentSpace(KINTASK_SPACE_DID);
        const currentSpace = client.currentSpace();
        if (currentSpace?.did() !== KINTASK_SPACE_DID) {
            throw new Error(`Failed to set current space correctly.`);
        }
        console.log(`Successfully set current space: ${client.currentSpace()?.did()}`);
    } catch (error) {
        console.error(`\nError setting space ${KINTASK_SPACE_DID}: ${error.message}`);
        process.exit(1);
    }
    return client;
}

/**
 * Uploads the single paper file.
 * @param {object} client Initialized w3up client. // JSDoc type instead of TS
 */
async function uploadPaper(client) { // <-- Removed : any
    console.log(`\nReading paper file: ${PAPER_FILE_PATH}`);
    try {
        const fileContent = await fs.readFile(PAPER_FILE_PATH); // Read as buffer/bytes
        const paperFileObject = new File([fileContent], path.basename(PAPER_FILE_PATH)); // Use original filename

        console.log(`Uploading ${paperFileObject.name}...`);
        const paperCid = await client.uploadFile(paperFileObject);
        const cidString = paperCid.toString();
        console.log(`   ✅ Paper uploaded! CID: ${cidString}`);

        // --- Final Output ---
        console.log(`\n---------------------------------------------------------------------`);
        console.log(`\n✅ Successfully Uploaded Paper File -> CID: ${cidString}`); // Changed paperCid to cidString for clarity
        console.log(`\nACTION REQUIRED:`);
        console.log(`  1. Copy the Paper File CID above (${cidString}).`);
        console.log(`  2. Paste it into the PAPER_CID variable in packages/backend/.env`);
        console.log(`     (You might need to rename KB_INDEX_CID to PAPER_CID or add a new PAPER_CID variable)`);
        console.log(`\n---------------------------------------------------------------------`);

    } catch (error) { // Removed : any for error
        if (error.code === 'ENOENT') {
            console.error(`\nSCRIPT FAILED: Paper file not found at ${PAPER_FILE_PATH}`);
            console.error("Please create the file 'scripts/knowledge_source/paper.txt' with the scientific text.");
        } else {
            console.error('\nSCRIPT FAILED during file read or upload:', error.message, error.stack);
        }
        process.exit(1);
    }
}

// --- Main Execution ---
async function main() {
    const client = await initializeW3upClient();
    await uploadPaper(client);
}

main().catch(err => {
    console.error("Unhandled error in main execution:", err);
    process.exit(1);
});