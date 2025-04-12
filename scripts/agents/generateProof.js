// scripts/generateTestProof.js
import * as snarkjs from "snarkjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Define inputs matching those used in answeringAgent debug constants
const inputsForProof = {
    requestContextHash: '104201417612360622557437849895377347656730927464708436169594540671751263611612',
    kbContentHash: '42492320066964546395290806120060426802344360221593668933408798506130418744051',
    questionHash: '70622639689279718371527342103894932928233838121221666359043189029713682937432',
    answerHash: '59261237941231663662109735270693870829345012465949809851421901625291403986032',
    llmResponseHash: '78507444318463763036097264421425979536077032836461591712012216061442719456116',
    answeringAgentId: '842451066378328870182696748786296232992000332453',
    evaluationVerdict: '0',
    evaluationConfidence: '50',
    parsedVerdictCode: '0',  // Private inputs
    parsedConfidenceScaled: '50' // Private inputs
};

// Calculate paths relative to the project root (process.cwd())
const projectRoot = process.cwd(); // Assumes script is run from project root
const wasmPath = path.resolve(projectRoot, "packages/contracts/circuits/evaluator/build/evaluator_js/evaluator.wasm");
const zkeyPath = path.resolve(projectRoot, "packages/contracts/circuits/evaluator/build/evaluator_final.zkey");


async function generateAndLogProof() {
    console.log("Generating proof with hardcoded inputs locally...");
    console.log("Inputs:", JSON.stringify(inputsForProof, null, 2));
    console.log("Attempting to use WASM Path:", wasmPath);
    console.log("Attempting to use ZKEY Path:", zkeyPath);

    // Check if files exist before trying to use them
    if (!fs.existsSync(wasmPath)) {
        console.error(`\n--- ERROR: WASM file not found at the expected path ---`);
        console.error(`Expected path: ${wasmPath}`);
        console.error(`Please ensure the circuit is compiled and the file exists.`);
        return;
    }
     if (!fs.existsSync(zkeyPath)) {
        console.error(`\n--- ERROR: ZKEY file not found at the expected path ---`);
        console.error(`Expected path: ${zkeyPath}`);
        console.error(`Please ensure the circuit setup generated the final zkey.`);
        return;
    }
    console.log("Circuit WASM and ZKEY files found.");


    try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputsForProof, wasmPath, zkeyPath);

        console.log("\n\n--- Proof Generated Locally ---");
        console.log("\nCopy the following values into HARDCODED_PROOF in answeringAgent.js:");
        console.log("\n'a': [");
        console.log(`    "${proof.pi_a[0].toString()}",`);
        console.log(`    "${proof.pi_a[1].toString()}"`);
        console.log("],");
        console.log("'b': [");
        console.log("    [");
        console.log(`        "${proof.pi_b[0][0].toString()}",`);
        console.log(`        "${proof.pi_b[0][1].toString()}"`);
        console.log("    ],");
        console.log("    [");
        console.log(`        "${proof.pi_b[1][0].toString()}",`);
        console.log(`        "${proof.pi_b[1][1].toString()}"`);
        console.log("    ]");
        console.log("],");
        console.log("'c': [");
        console.log(`    "${proof.pi_c[0].toString()}",`);
        console.log(`    "${proof.pi_c[1].toString()}"`);
        console.log("]");

        console.log("\n\n--- Public Signals Generated Locally ---");
        const formattedPublicSignals = publicSignals.map(v => v.toString());
        console.log("\nVerify these match HARDCODED_PUBLIC_SIGNALS in answeringAgent.js:");
        console.log("[\n  '" + formattedPublicSignals.join("',\n  '") + "'\n]");


    } catch (error) {
        console.error("\n\n--- ERROR Generating Proof ---");
        console.error(error);
    }
}

generateAndLogProof();