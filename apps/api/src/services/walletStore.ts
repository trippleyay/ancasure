/**
 * SQLite persistence for application-level wallet relationships.
 *
 * IMPORTANT SCOPE: this store records ONLY who added which wallet, and when:
 *   owner_address, wallet_address, created_at
 * It deliberately holds NO insurance state — coverage status, expiry, premium,
 * payout amount, or claim eligibility. That state is owned exclusively by the
 * AncaSureClaims contract and is read live from it (see services/claims.ts).
 * Creditcoin/Attestcoin is only the evidence verifier for external-chain
 * transactions; it is never the insurance-policy authority.
 *
 * The database file is created automatically on startup. Its path comes from
 * DATABASE_PATH (default: <repo>/data/ancasure.db). When TURSO_DATABASE_URL is
 * set, the backend is Turso (managed SQLite) instead — same schema, same queries.
 */
import { createDb, type Db } from "./db.js";

export interface WalletRow {
  ownerAddress: string;
  walletAddress: string;
  createdAt: string;
}

export class WalletStore {
  private db: Db;

  private constructor(db: Db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        owner_address  TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        PRIMARY KEY (owner_address, wallet_address)
      )
    `);
  }

  /** Create a WalletStore backed by the configured database (Turso or local file). */
  static async create(): Promise<WalletStore> {
    return new WalletStore(await createDb());
  }

  /** Create a WalletStore with an explicit Db (for tests). */
  static forDb(db: Db): WalletStore {
    return new WalletStore(db);
  }

  /** All wallet rows for one owner, oldest first. */
  async list(ownerAddress: string): Promise<WalletRow[]> {
    const rows = await this.db.all<{
      owner_address: string;
      wallet_address: string;
      created_at: string;
    }>(
      "SELECT owner_address, wallet_address, created_at FROM wallets WHERE owner_address = ? ORDER BY created_at, rowid",
      ownerAddress.toLowerCase(),
    );
    return rows.map((r) => ({
      ownerAddress: r.owner_address,
      walletAddress: r.wallet_address,
      createdAt: r.created_at,
    }));
  }

  async has(ownerAddress: string, walletAddress: string): Promise<boolean> {
    const row = await this.db.get(
      "SELECT 1 FROM wallets WHERE owner_address = ? AND wallet_address = ?",
      ownerAddress.toLowerCase(),
      walletAddress.toLowerCase(),
    );
    return row !== undefined;
  }

  /** Insert a wallet; returns false when the (owner, wallet) pair already exists. */
  async add(ownerAddress: string, walletAddress: string): Promise<boolean> {
    const info = await this.db.run(
      "INSERT OR IGNORE INTO wallets (owner_address, wallet_address, created_at) VALUES (?, ?, ?)",
      ownerAddress.toLowerCase(),
      walletAddress.toLowerCase(),
      new Date().toISOString(),
    );
    return info.changes > 0;
  }

  /** Remove a wallet; returns true when a row was actually deleted. */
  async remove(ownerAddress: string, walletAddress: string): Promise<boolean> {
    const info = await this.db.run(
      "DELETE FROM wallets WHERE owner_address = ? AND wallet_address = ?",
      ownerAddress.toLowerCase(),
      walletAddress.toLowerCase(),
    );
    return info.changes > 0;
  }

  async count(ownerAddress: string): Promise<number> {
    const row = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM wallets WHERE owner_address = ?", ownerAddress.toLowerCase());
    return Number(row?.n ?? 0);
  }

  close(): void {
    this.db.close();
  }
}

/** Shared store for the running API process — initialized by initWalletStore(). */
export let walletStore: WalletStore;

/** Initialize the shared wallet store (call once at startup before using walletStore). */
export async function initWalletStore(): Promise<void> {
  walletStore = await WalletStore.create();
}
