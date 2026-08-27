import { ethers } from "ethers";

/**
 * Thin RPC layer over an ethers JsonRpcProvider with an in-memory cache for
 * immutable data (transactions and receipts of mined txs never change).
 */
export class RpcClient {
  private provider: ethers.JsonRpcApiProvider;
  private txCache = new Map<string, Promise<ethers.TransactionResponse | null>>();
  private receiptCache = new Map<string, Promise<ethers.TransactionReceipt | null>>();
  private blockTxHashes = new Map<number, Promise<string[]>>();

  constructor(rpcUrl: string) {
    if (!rpcUrl) throw new Error("ETHEREUM_RPC_URL is not set");
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  getProvider(): ethers.Provider & { send: (method: string, params: unknown[]) => Promise<unknown> } {
    return this.provider as never;
  }

  async getTransaction(hash: string): Promise<ethers.TransactionResponse | null> {
    if (!this.txCache.has(hash)) {
      const p = this.provider.getTransaction(hash).catch(() => null);
      this.txCache.set(hash, p);
    }
    const tx = await this.txCache.get(hash)!;
    return tx && tx.blockNumber !== null ? tx : tx; // unmined returned as-is
  }

  async getTransactionReceipt(hash: string): Promise<ethers.TransactionReceipt | null> {
    if (!this.receiptCache.has(hash)) {
      const p = this.provider.getTransactionReceipt(hash).catch(() => null);
      this.receiptCache.set(hash, p);
    }
    return this.receiptCache.get(hash)!;
  }

  /**
   * Fetch transaction at (blockNumber, index) via eth_getBlockByNumber with
   * full transaction objects. Block tx-hash list is cached per block.
   */
  async getTransactionByBlockAndIndex(
    blockNumber: number,
    index: number,
  ): Promise<ethers.TransactionResponse | null> {
    if (!this.blockTxHashes.has(blockNumber)) {
      const p = this.provider
        .send("eth_getBlockByNumber", ["0x" + blockNumber.toString(16), true])
        .then((raw) =>
          raw && raw.transactions
            ? (raw.transactions as Record<string, string>[]).map((t) => t.hash)
            : [],
        );
      this.blockTxHashes.set(blockNumber, p);
    }
    const hashes = await this.blockTxHashes.get(blockNumber)!;
    const hash = hashes[index];
    return hash ? this.getTransaction(hash) : null;
  }
}
