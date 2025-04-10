// scripts/calculateHash.js
import fs from 'fs';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Determine script's directory to correctly locate the knowledge source ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration: Path to the file to hash ---
// Adjust this path relative to the location of THIS script (scripts/)
const relativeFilePath = './knowledge_source/paper.txt';
const filePath = path.resolve(__dirname, relativeFilePath);

// --- Main Logic ---
try {
    console.log(`Attempting to read file: ${filePath}`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found at specified path: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(content));
    console.log(`\nContent Hash (keccak256) for ${relativeFilePath}:`);
    console.log(hash);
    console.log("\nUse this hash when running 'registerKB.js'");
} catch (error) {
    console.error(`\nError calculating hash: ${error.message}`);
    process.exit(1);
}
