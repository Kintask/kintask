// memoryBlockstore.js
export class MemoryBlockstore {
    constructor() {
      this.blocks = new Map();
    }
  
    async put(cid, bytes) {
      this.blocks.set(cid.toString(), { cid, bytes });
      return;
    }
  
    async get(cid) {
      const block = this.blocks.get(cid.toString());
      if (!block) throw new Error(`Block with CID ${cid.toString()} not found`);
      return block.bytes;
    }
  
    async has(cid) {
      return this.blocks.has(cid.toString());
    }
  
    async *blocks() {
      for (const block of this.blocks.values()) {
        yield block;
      }
    }
  
    async delete(cid) {
      this.blocks.delete(cid.toString());
    }
  }