// kintask/scripts/upload-car.js
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
dotenv.config({ path: path.resolve(__dirname, '../packages/backend/.env') });

// --- Configuration ---
const W3UP_AGENT_EMAIL = process.env.W3UP_AGENT_EMAIL;
const KINTASK_SPACE_DID = process.env.KINTASK_SPACE_DID;
// --- Get CAR File Path from Command Line Argument ---
const relativeCarPath = process.argv[2]; // Get path from command line

// --- Validation ---
if (!W3UP_AGENT_EMAIL) { console.error("\nFATAL ERROR: W3UP_AGENT_EMAIL not configured"); process.exit(1); }
if (!KINTASK_SPACE_DID || !KINTASK_SPACE_DID.startsWith('did:key:')) { console.error("\nFATAL ERROR: KINTASK_SPACE_DID invalid"); process.exit(1); }
if (!relativeCarPath) { console.error("\nFATAL ERROR: Please provide the relative path to the CAR file as a command line argument."); console.error("Example: node scripts/upload-car.js ./output_cars_ezprep/your_file.car"); process.exit(1); }
// Resolve the path relative to the PROJECT ROOT (where node command is run from)
const CAR_FILE_PATH = path.resolve(process.cwd(), relativeCarPath);

/**
 * Initializes the w3up client, logs in the agent, and sets the target space.
 */
async function initializeW3upClient() {
    console.log("Initializing w3up client...");
    const client = await create();
    const currentAccount = client.accounts()[W3UP_AGENT_EMAIL];
    if (currentAccount && !currentAccount.disconnected) {
        console.log(`Agent already logged in as ${W3UP_AGENT_EMAIL}.`);
    } else {
        console.log(`Logging in agent ${W3UP_AGENT_EMAIL}...`);
        // Add a slight delay and prompt for email check if login is needed
        console.log(">>> Please check your email for the verification link and click it NOW. <<<");
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
        try {
            await client.login(W3UP_AGENT_EMAIL);
            console.log("Agent login attempt finished (check email if needed).");
        } catch (error) {
            console.error("\nLogin failed.", error.message);
            console.error("Please ensure you clicked the email link if required.");
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
 * Uploads the specified CAR file.
 * @param {object} client Initialized w3up client.
 * @param {string} carFilePath Absolute path to the CAR file.
 */
async function uploadCarFile(client, carFilePath) {
    console.log(`\nReading CAR file: ${carFilePath}`);
    try {
        // Read as buffer for uploadCAR which expects Blob/File view
        const fileBuffer = await fs.readFile(carFilePath);
        // Create a File object needed by uploadCAR
        const carFileObject = new File([fileBuffer], path.basename(carFilePath));

        console.log(`Uploading ${carFileObject.name} (${(fileBuffer.length / 1024).toFixed(2)} KB)...`);
        // Use uploadCAR for direct CAR upload
        const carCid = await client.uploadCAR(carFileObject);
        const cidString = carCid.toString();
        const httpUrl = `https://w3s.link/ipfs/${cidString}`; // Use CAR CID for URL

        console.log(`   ✅ CAR uploaded! CID: ${cidString}`);
        console.log(`\n---------------------------------------------------------------------`);
        console.log(`\n✅ Successfully Uploaded CAR File -> CID: ${cidString}`);
        console.log(`   Public HTTP URL: ${httpUrl}`);
        console.log(`\nACTION REQUIRED:`);
        console.log(`  1. Copy the HTTP URL above.`);
        console.log(`  2. Use it for the --http-url flag in the 'boost deal' command.`);
        console.log(`\n---------------------------------------------------------------------`);
        return httpUrl; // Return the URL

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`\nSCRIPT FAILED: CAR file not found at ${carFilePath}`);
        } else {
            console.error('\nSCRIPT FAILED during CAR read or upload:', error.message);
        }
        process.exit(1);
    }
}

// --- Main Execution ---
async function main() {
    console.log(`Attempting to upload CAR file: ${CAR_FILE_PATH}`);
    const client = await initializeW3upClient();
    await uploadCarFile(client, CAR_FILE_PATH);
}

main().catch(err => {
    console.error("Unhandled error in main execution:", err);
    process.exit(1);
});
