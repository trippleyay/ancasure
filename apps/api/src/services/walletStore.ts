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
 * DATABASE_PATH (default: <repo>/data/ancasure.db).
 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";

export interface WalletRow {
  ownerAddress: string;
  walletAddress: string;
  createdAt: string;
}

const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "..", "..", "..", "data", "ancasure.db");

export class WalletStore {
  private db: DatabaseSync;

  constructor(dbPath = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // unique(owner_address, wallet_address) is the primary key.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        owner_address  TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        PRIMARY KEY (owner_address, wallet_address)
      )
    `);
  }

  /** All wallet rows for one owner, oldest first. */
  list(ownerAddress: string): WalletRow[] {
    const stmt = this.db.prepare(
      "SELECT owner_address, wallet_address, created_at FROM wallets WHERE owner_address = ? ORDER BY created_at, rowid",
    );
    return stmt.all(ownerAddress.toLowerCase()).map((r: any) => ({
      ownerAddress: r.owner_address,
      walletAddress: r.wallet_address,
      createdAt: r.created_at,
    }));
  }

  has(ownerAddress: string, walletAddress: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM wallets WHERE owner_address = ? AND wallet_address = ?");
    return stmt.get(ownerAddress.toLowerCase(), walletAddress.toLowerCase()) !== undefined;
  }

  /** Insert a wallet; returns false when the (owner, wallet) pair already exists. */
  add(ownerAddress: string, walletAddress: string): boolean {
    const info = this.db
      .prepare("INSERT OR IGNORE INTO wallets (owner_address, wallet_address, created_at) VALUES (?, ?, ?)")
      .run(ownerAddress.toLowerCase(), walletAddress.toLowerCase(), new Date().toISOString());
    return Number(info.changes) > 0;
  }

  /** Remove a wallet; returns true when a row was actually deleted. */
  remove(ownerAddress: string, walletAddress: string): boolean {
    const info = this.db
      .prepare("DELETE FROM wallets WHERE owner_address = ? AND wallet_address = ?")
      .run(ownerAddress.toLowerCase(), walletAddress.toLowerCase());
    return Number(info.changes) > 0;
  }

  count(ownerAddress: string): number {
    const stmt = this.db.prepare("SELECT COUNT(*) AS n FROM wallets WHERE owner_address = ?");
    return Number((stmt.get(ownerAddress.toLowerCase()) as any).n);
  }

  close(): void {
    this.db.close();
  }
}

/** Shared store for the running API process (created on startup). */
export const walletStore = new WalletStore();
