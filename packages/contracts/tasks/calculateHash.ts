import { task } from "hardhat/config";
import * as fs from "fs/promises";
// REMOVED direct import of ethers: import { ethers } from "ethers";
import * as path from "path";

task("calculate-hash", "Calculates Keccak256 hash of a file for ZKP input")
  .addParam("file", "Path to the file relative to project root")
  .setAction(async (taskArgs, hre) => { // hre is passed automatically
    const projectRoot = path.resolve(hre.config.paths.root, "../..");
    const filePath = path.resolve(projectRoot, taskArgs.file);

    console.log(`Calculating Keccak256 hash for file: ${filePath}`);
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');

      // --- Use hre.ethers.utils ---
      // Note: Hardhat v2.22 likely uses ethers v6 internally via toolbox
      // Let's use v6 syntax if available, otherwise try v5 syntax
      let digest: string;
      let bigIntValue: BigInt; // Use native BigInt with ethers v6

      if (hre.ethers.keccak256 && hre.ethers.toUtf8Bytes) {
          // Assume ethers v6 syntax via hre
          console.log("(Using hre.ethers v6 syntax)")
          const hashBytes = hre.ethers.toUtf8Bytes(fileContent);
          digest = hre.ethers.keccak256(hashBytes);
          bigIntValue = hre.ethers.toBigInt(digest);
      } else if (hre.ethers.utils && hre.ethers.utils.toUtf8Bytes && hre.ethers.utils.keccak256 && hre.ethers.BigNumber) {
           // Fallback to ethers v5 syntax via hre.ethers.utils
           console.log("(Using hre.ethers.utils v5 syntax)")
           const hashBytes = hre.ethers.utils.toUtf8Bytes(fileContent);
           digest = hre.ethers.utils.keccak256(hashBytes);
           bigIntValue = hre.ethers.BigNumber.from(digest).toBigInt(); // Convert v5 BigNumber to native BigInt
      } else {
          throw new Error("Could not find compatible ethers hashing utilities via hre.ethers");
      }
      // --- End using hre.ethers ---

      console.log(`\nFile Path: ${taskArgs.file} (resolved: ${filePath})`);
      console.log(`Content Hash (bytes32 hex): ${digest}`);
      console.log(`Content Hash (BigInt): ${bigIntValue.toString()}`); // Use native BigInt's toString()

    } catch (error: any) {
      if (error.code === 'ENOENT') {
           console.error(`\nError: File not found at resolved path: ${filePath}`);
           console.error(`Please ensure the --file path is correct relative to the project root.`);
      } else {
           console.error(`\nError calculating hash: ${error.message}`);
           // console.error(error); // Optional full error stack
      }
    }
  });

export {};
