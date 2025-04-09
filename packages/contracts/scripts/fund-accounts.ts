import { ethers } from "hardhat";

// Script to fund test accounts with small amounts of FIL for testing
async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log(`Using deployer account: ${deployer.address}`);
  console.log(`Deployer balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} FIL`);
  
  // Create new wallet instances for testing
  // These will be random wallets that we'll fund
  const agent1 = ethers.Wallet.createRandom().connect(ethers.provider);
  const agent2 = ethers.Wallet.createRandom().connect(ethers.provider);
  const agent3 = ethers.Wallet.createRandom().connect(ethers.provider);
  const evidenceSubmitter = ethers.Wallet.createRandom().connect(ethers.provider);
  
  // Amount to send to each account
  const fundAmount = ethers.parseEther("0.05"); // 0.05 FIL per account
  
  // Fund accounts
  const accounts = [
    { name: "Agent 1", wallet: agent1 },
    // { name: "Agent 2", wallet: agent2 },
    { name: "Agent 3", wallet: agent3 },
    { name: "Evidence Submitter", wallet: evidenceSubmitter }
  ];
  
  console.log("\nGenerated test accounts:");
  for (const account of accounts) {
    console.log(`${account.name}: ${account.wallet.address} (Private key: ${account.wallet.privateKey})`);
  }
  
  console.log("\nFunding accounts...");
  for (const account of accounts) {
    console.log(`Funding ${account.name}: ${account.wallet.address}`);
    
    try {
      const tx = await deployer.sendTransaction({
        to: account.wallet.address,
        value: fundAmount
      });
      
      console.log(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log(`Transaction confirmed`);
      console.log(`New balance: ${ethers.formatEther(await ethers.provider.getBalance(account.wallet.address))} FIL`);
    } catch (error) {
      console.error(`Error funding ${account.name}:`, error);
    }
  }
  
  console.log("\nAll accounts funded successfully!");
  console.log("Keep these accounts and private keys to use in your tests.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });