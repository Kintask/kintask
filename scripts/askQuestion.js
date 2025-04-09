#!/usr/bin/env node

// Use ESM import syntax
import * as readline from 'node:readline/promises'; // Import specific module
import axios from 'axios'; // Standard import for axios
import process from 'node:process'; // Import process explicitly

// Create readline interface (needs slight adjustment for ESM)
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// --- Configuration ---
const BACKEND_API_URL = 'http://localhost:3001/api/ask';

// Basic CID Validation
function isValidCid(cid) {
    if (!cid || typeof cid !== 'string') {
        return false;
    }
    return cid.startsWith('Qm') || cid.startsWith('bafy') || cid.startsWith('bafk');
}

// Main async function
async function run() {
    console.log('--- Kintask Question Submitter (ESM) ---');
    let question = '';
    let knowledgeBaseCid = '';

    try {
        // 1. Get Question using the imported interface
        question = await rl.question('Enter the question you want to ask: ');
        if (!question.trim()) {
            throw new Error('Question cannot be empty.');
        }

        // 2. Get CID
        while (!isValidCid(knowledgeBaseCid)) {
            knowledgeBaseCid = await rl.question('Enter the Knowledge Base CID: ');
            if (!isValidCid(knowledgeBaseCid)) {
                console.error('Invalid CID format. Please try again (starts with Qm, bafy, or bafk).');
            }
        }

        // 3. Prepare Payload
        const payload = {
            question: question.trim(),
            knowledgeBaseCid: knowledgeBaseCid.trim(),
        };

        console.log('\nSubmitting to backend...');
        console.log('URL:', BACKEND_API_URL);
        console.log('Payload:', JSON.stringify(payload));

        // 4. Send Request using imported axios
        const response = await axios.post(BACKEND_API_URL, payload, {
             headers: { 'Content-Type': 'application/json' },   
             timeout: 15000
         });

        // 5. Handle Success
        console.log('\n--- Submission Successful! ---');
        console.log('Status:', response.status);
        // Access response data directly
        console.log('Backend Message:', response.data.message);
        console.log('Request Context ID:', response.data.requestContext);
        console.log('Recall Key:', response.data.recallKey);
        console.log('\nYou can use the Request Context ID to check the status later via GET /api/status/{requestContext}');

    } catch (error) {
        // 6. Handle Errors
        console.error('\n--- Submission Failed! ---');
        if (axios.isAxiosError(error)) {
            if (error.response) {
                console.error('Error Status:', error.response.status);
                console.error('Error Data:', JSON.stringify(error.response.data, null, 2));
            } else if (error.request) {
                console.error('Network Error: No response received from the server.');
                console.error('Is the backend server running at', BACKEND_API_URL, '?');
            } else {
                console.error('Axios Error:', error.message);
            }
        } else {
            console.error('Error:', error.message || error);
        }
    } finally {
        // 7. Close readline interface
        rl.close();
    }
}

// Run the main function
run();

// ==== ./scripts/askQuestionCli.js (ESM Version) ====