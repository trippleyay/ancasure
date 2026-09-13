/**
 * Unified async database abstraction.
 *
 * Backends (chosen by env at startup):
 *   - Turso (managed SQLite in the cloud) when TURSO_DATABASE_URL is set — lets
 *     the API run stateless on free tiers (Render, Koyeb, Vercel serverless).
 *   - Local node:sqlite file otherwise — zero external dependency, same code.
 *
 * Both speak SQLite, so the schema and queries are identical. The interface is
 * async even for the local file so callers don't care which backend is live.
 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";

// Minimal structural type for the Turso client — avoids a static ESM import
// (which TS flags under CJS, even though `import type` is erased at runtime).
interface TursoClient {
  execute(opts: { sql: string; args?: any[] }): Promise<{ rows: any[]; rowsAffected?: number; lastInsertRowid?: number | bigint }>;
  close(): void;
}

export interface Db {
  all<T = any>(sql: string, ...args: any[]): Promise<T[]>;
  get<T = any>(sql: string, ...args: any[]): Promise<T | undefined>;
  run(sql: string, ...args: any[]): Promise<{ changes: number; lastInsertRowid: bigint }>;
  exec(sql: string): Promise<void>;
  close(): void;
}

class TursoDb implements Db {
  constructor(private client: TursoClient) {}
  async all<T>(sql: string, ...args: any[]): Promise<T[]> {
    return (await this.client.execute({ sql, args: args as any })).rows as T[];
  }
  async get<T>(sql: string, ...args: any[]): Promise<T | undefined> {
    const r = await this.client.execute({ sql, args: args as any });
    return r.rows[0] as T | undefined;
  }
  async run(sql: string, ...args: any[]) {
    const r = await this.client.execute({ sql, args: args as any });
    return { changes: Number(r.rowsAffected ?? 0), lastInsertRowid: BigInt(r.lastInsertRowid ?? 0) };
  }
  async exec(sql: string) {
    await this.client.execute({ sql });
  }
  close() {
    void this.client.close();
  }
}

class SqliteDb implements Db {
  constructor(private db: DatabaseSync) {}
  async all<T>(sql: string, ...args: any[]): Promise<T[]> {
    return this.db.prepare(sql).all(...args) as T[];
  }
  async get<T>(sql: string, ...args: any[]): Promise<T | undefined> {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  async run(sql: string, ...args: any[]) {
    const info = this.db.prepare(sql).run(...args);
    return { changes: Number(info.changes), lastInsertRowid: BigInt(info.lastInsertRowid) };
  }
  async exec(sql: string) {
    this.db.exec(sql);
  }
  close() {
    this.db.close();
  }
}

/** Create a local-file SQLite Db (always file-based, used by tests and as fallback). */
export function createSqliteDb(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new SqliteDb(new DatabaseSync(dbPath));
}

/** Pick the backend from env: Turso if configured, else local file. */
export async function createDb(): Promise<Db> {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  // Skip Turso when the URL is unset or still the placeholder from .env.example.
  if (tursoUrl && !tursoUrl.includes("your-db")) {
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!authToken || authToken.includes("your-turso")) {
      throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set");
    }
    const { createClient } = await import("@libsql/client");
    return new TursoDb(createClient({ url: tursoUrl, authToken }) as unknown as TursoClient);
  }
  const dbPath =
    process.env.DATABASE_PATH ?? path.resolve(__dirname, "..", "..", "..", "..", "data", "ancasure.db");
  return createSqliteDb(dbPath);
}
