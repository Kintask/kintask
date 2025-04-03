// packages/backend/src/types/blocklock-js.d.ts

/**
 * Placeholder type definitions for 'blocklock-js'.
 * Replace with more specific types if known or provided by the library later.
 * Based on usage in timelockService.ts and Blocklock documentation examples.
 */
declare module 'blocklock-js' {

    // Assuming TypesLib.Ciphertext structure based on Solidity usage
    // This might need adjustments based on the actual JS object structure
    export namespace TypesLib {
      export interface Ciphertext {
        v: Uint8Array | string; // Or Buffer? Usually bytes represented as hex string or Uint8Array
        r: Uint8Array | string;
        s: Uint8Array | string;
        u: [string, string] | [bigint, bigint]; // Point coordinates (often strings or BigInts)
        ephKey?: any; // Optional/Internal? Check library details
      }
    }
  
    // Placeholder for the result of encodeCiphertextToSolidity
    // Based on contract expectation, it's likely a tuple/struct matching Solidity's TypesLib.Ciphertext
    export type SolidityCiphertextStruct = {
       v: string; // Hex string for bytes
       r: string; // Hex string for bytes32 or similar
       s: string; // Hex string for bytes32 or similar
       u: [string, string]; // String tuple for uint256[2]
       // Adjust types based on actual Solidity struct definition
    };
  
    // Main Blocklock class
    export class Blocklock {
      constructor(wallet: any, blocklockSenderProxyAddress: string); // Use 'any' for wallet initially
  
      // Encrypt method signature based on usage
      encrypt(messageBytes: Uint8Array | Buffer, blockHeight: bigint): TypesLib.Ciphertext;
  
      // Decrypt method (if used in JS, based on docs) - Check return type
      decryptWithId(requestId: string | number | bigint): Promise<Uint8Array | Buffer | string>; // Adjust return type
    }
  
    // SolidityEncoder class (if used - based on docs)
    export class SolidityEncoder {
      constructor();
      // Add specific methods if known, otherwise keep it simple
      // Example based on docs:
      encodeUint256(value: bigint | string): string; // Returns hex string likely
      // encodeString(value: string): string;
      // encodeBytes(value: Uint8Array | Buffer | string): string;
      // ... other encoding methods
    }
  
    // Function to convert JS Ciphertext object to Solidity struct/tuple format
    export function encodeCiphertextToSolidity(ciphertext: TypesLib.Ciphertext): SolidityCiphertextStruct; // Adjust return type if needed
  
    // Add other exports from the library if you use them
  }