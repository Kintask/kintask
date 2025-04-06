// packages/contracts/tasks/filfoxVerify.ts
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs";
import path from "path";
import axios from "axios"; // Use axios for making HTTP requests

task("filfox-verify", "Verifies contract source code on Filfox (Calibration)")
    // Contract address (required)
    .addParam("address", "The deployed contract address (0x, f0, or f4 format)")
    // Path to the main contract source file (required)
    .addParam("contract", "Path to the contract source file (e.g., contracts/Aggregator.sol)")
    // Optional SPDX license identifier
    .addOptionalParam("license", "SPDX License Identifier (e.g., MIT, Unlicense)", "No License (None)")
    // Optional libraries JSON string
    .addOptionalParam("libraries", "JSON string of libraries used if any (e.g., '{\"Lib1\":\"0x...\"}')", "")
    .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
        const { address, contract, license, libraries: librariesJsonString } = taskArgs;
        const networkName = hre.network.name; // Get the current network name

        console.log(`Starting verification for contract ${contract} at address ${address} on network ${networkName}`);

        // --- Network Validation ---
        if (networkName !== "calibration") {
            console.error("This task is currently configured only for the 'calibration' network.");
            return;
        }
        // API Key is handled by hardhat config etherscan section, even if empty

        // --- Get Compiler Settings from Hardhat Config for 0.8.24 ---
        const solcVersionString = "0.8.24"; // The version confirmed from build info
        const solcConfig = hre.config.solidity.compilers.find(c => c.version === solcVersionString);

        if (!solcConfig) {
            console.error(`Solidity compiler config for version ${solcVersionString} not found in hardhat.config.ts`);
            console.error(`Please ensure hardhat.config.ts includes an entry for "${solcVersionString}" in solidity.compilers`);
            return;
        }

        // Use the exact commit hash confirmed from build info
        const exactCommitHash = "e11b9ed9";
        const exactCompilerVersion = `v${solcVersionString}+commit.${exactCommitHash}`;
        console.log(`Using exact compiler version: ${exactCompilerVersion}`);

        // Read settings used for deployment (MUST MATCH)
        const isOptimized = solcConfig.settings?.optimizer?.enabled || false;
        const optimizeRuns = solcConfig.settings?.optimizer?.runs || 200;
        const viaIr = solcConfig.settings?.viaIR || false;
        console.log(`Compiler Settings: Version=${exactCompilerVersion}, Optimized=${isOptimized}, Runs=${optimizeRuns}, ViaIR=${viaIr}`);

        // --- Parse Libraries (if provided) ---
        let libraries = {}; // Default to empty object
        if (librariesJsonString) {
            try {
                libraries = JSON.parse(librariesJsonString);
                console.log("Using Libraries:", libraries);
            } catch (e) {
                console.error("Error: Invalid JSON string provided for --libraries argument.");
                console.error("Example format: --libraries '{\"contracts/SafeMath.sol:SafeMath\":\"0x...\"}'");
                return;
            }
        }

        // --- Flatten Contract ---
        console.log(`Flattening contract: ${contract}...`);
        let flattenedSource: string;
        try {
            // Ensure contract path exists before flattening
            const contractFullPath = path.resolve(hre.config.paths.sources, path.relative(hre.config.paths.sources, contract));
             if (!fs.existsSync(contractFullPath) && !fs.existsSync(contract)) {
                 console.error(`Error: Contract file not found at path: ${contract}. Provide path relative to project root or contracts dir.`);
                 return;
             }
            // Use Hardhat's built-in flatten task
            flattenedSource = await hre.run("flatten:get-flattened-sources", { files: [contract] });
            // Check if flattening actually included imports - basic check
            if (flattenedSource.length < 500 || !flattenedSource.includes("library CommonTypes")) { // Adjust check based on expected content
                 console.warn("WARNING: Flattened source seems unexpectedly small or missing expected imports (@zondax/...). Check remappings in hardhat.config.ts if imports failed.");
            }
        } catch (error: any) {
            console.error("Error flattening contract:", error.message);
            return;
        }
        console.log("Contract flattened successfully.");

        // --- Prepare API Payload ---
        const sourceFiles = {
            // Filfox expects a single entry for flattened source. Use contract base name.
            [path.basename(contract)]: {
                content: flattenedSource
            }
        };

        // Construct the data payload for the Filfox API
        const apiData: Record<string, any> = { // Use Record<string, any> for flexibility
            address: address,
            language: "Solidity",
            compiler: exactCompilerVersion,
            optimize: isOptimized,
            optimizeRuns: optimizeRuns,
            sourceFiles: sourceFiles,
            license: license,
            viaIR: viaIr,
            // Conditionally add libraries if provided
        };
        // Filfox API expects libraries as JSON string under 'libraries' key
        if (Object.keys(libraries).length > 0) {
            apiData.libraries = JSON.stringify(libraries);
        }

        // --- Make API Request ---
        const apiUrl = "https://calibration.filfox.info/api/v1/tools/verifyContract";
        console.log(`Sending verification request to ${apiUrl}...`);

        try {
            const response = await axios.post(apiUrl, apiData, {
                headers: { 'Content-Type': 'application/json' }
                // API key is not typically needed in request body/headers for Etherscan/Filfox verify APIs
            });

            console.log("Filfox API Response Status:", response.status);
            console.log("Filfox API Response Data:", JSON.stringify(response.data, null, 2));

            // --- Handle Response ---
            if (response.data?.success === true) {
                console.log(`✅ Contract ${response.data.contractName || path.basename(contract)} at ${address} verified successfully!`);
            } else {
                const errorCode = response.data?.errorCode;
                let errorMessage = `Verification failed.`;
                // Provide detailed error messages based on Filfox API docs
                 switch (errorCode) {
                    case 1: errorMessage = "Verification failed (Filfox Error Code 1): Source files not found by API."; break;
                    case 2: errorMessage = "Verification failed (Filfox Error Code 2): Contract initcode not found by API (check address/network)."; break;
                    case 3: errorMessage = `Verification failed (Filfox Error Code 3): Load remote compiler failed. Verify compiler version ('${exactCompilerVersion}') is correct and available on Filfox.`; break;
                    case 4: errorMessage = `Verification failed (Filfox Error Code 4): Bytecode mismatch. Double-check Compiler Version, Optimization (Enabled: ${isOptimized}, Runs: ${optimizeRuns}), Libraries, viaIR (${viaIr}), Source Code, and Constructor Arguments (if any, submit manually).`; break;
                    case 5: errorMessage = "Verification failed (Filfox Error Code 5): Unsupported language."; break;
                    case 6: errorMessage = "Verification failed (Filfox Error Code 6): Contract already verified."; break;
                    case 7: errorMessage = `Verification failed (Filfox Error Code 7): Compilation error reported by API: ${response.data?.errorMsg || 'Unknown compilation error'}`; break;
                    default: errorMessage = `Verification failed with unknown error code ${errorCode}. Response: ${JSON.stringify(response.data)}`;
                }
                console.error(`❌ ${errorMessage}`);
            }

        } catch (error: any) {
            console.error("❌ Error sending verification request to Filfox API:");
            if (axios.isAxiosError(error)) {
                if (error.response) { console.error("   Status:", error.response.status); console.error("   Data:", JSON.stringify(error.response.data, null, 2)); }
                else if (error.request) { console.error("   Error: No response received from Filfox API."); }
                else { console.error("   Axios Error:", error.message); }
            } else { console.error("   Unexpected Error:", error); }
        }
    });

// ==== ./packages/contracts/tasks/filfoxVerify.ts ====