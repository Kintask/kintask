import { ethers } from "ethers";

async function getAllLogs() {
  // Contract address as provided.
  const contractAddress = "0x2A1C1840FEf2a91c5a290DC9C0f69EabaeECAb67";

  // Use Ankr's Filecoin testnet RPC endpoint.
  const rpcUrl = "https://rpc.ankr.com/filecoin_testnet";
  const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
    chainId: 314159,
    name: "filecoin-testnet"
  });

  // Get current block number.
  const currentBlock = await provider.getBlockNumber();
  console.log("Current block number:", currentBlock);

  // Use a lookback window of 1,000 blocks.
  const fromBlock = currentBlock - 1000;
  console.log(`Querying logs from block ${fromBlock} to latest...`);

  // Define the filter for logs from the specified contract.
  const filter = {
    address: contractAddress,
    fromBlock,
    toBlock: "latest"
  };

  try {
    const logs = await provider.getLogs(filter);
    if (logs.length === 0) {
      console.log("No logs found in this block range.");
      return;
    }
    console.log(`Total logs found: ${logs.length}`);
    logs.forEach((log, index) => {
      console.log(`\nLog ${index + 1}:`);
      console.log(JSON.stringify(log, null, 2));
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
  }
}

getAllLogs();
