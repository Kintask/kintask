import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BLOCKLOCK_SENDER_PROXY_ADDRESS = process.env.BLOCKLOCK_SENDER_PROXY_ADDRESS;

// --- Input Validation outside the Module ---
if (!BLOCKLOCK_SENDER_PROXY_ADDRESS || typeof BLOCKLOCK_SENDER_PROXY_ADDRESS !== 'string' || !BLOCKLOCK_SENDER_PROXY_ADDRESS.startsWith('0x')) {
    throw new Error(
         `Invalid or missing BLOCKLOCK_SENDER_PROXY_ADDRESS in packages/contracts/.env. Value read: '${BLOCKLOCK_SENDER_PROXY_ADDRESS}'. Please check the .env file and Blocklock documentation for the correct address on the target network.`
    );
}
// --- End Input Validation ---


const KintaskCommitmentModule = buildModule("KintaskCommitmentModule", (m) => {
  console.log(`Ignition Module: Configuring deployment with Blocklock Sender Proxy default: ${BLOCKLOCK_SENDER_PROXY_ADDRESS}`);

  const blocklockProxy_parameter = m.getParameter(
    "blocklockProxy",
    BLOCKLOCK_SENDER_PROXY_ADDRESS
  );

  const kintaskCommitment = m.contract("KintaskCommitment", [blocklockProxy_parameter], {
    id: "KintaskCommitmentContract",
  });

  return { kintaskCommitment };
});

export default KintaskCommitmentModule;