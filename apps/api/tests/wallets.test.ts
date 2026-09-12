import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WalletStore } from "../src/services/walletStore.js";
import { buildWalletBook, type WalletBook } from "../src/services/walletBook.js";
import type { PolicyInfo } from "../src/services/claims.js";

const O1 = "0x" + "11".repeat(20);
const O2 = "0x" + "22".repeat(20);
const W1 = "0x" + "aa".repeat(20);
const W2 = "0x" + "bb".repeat(20);
const W3 = "0x" + "cc".repeat(20);

let dir: string;
let dbPath: string;
let store: WalletStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ancasure-wallets-"));
  dbPath = path.join(dir, "ancasure.db");
  store = new WalletStore(dbPath);
});

afterAll(() => {
  try { store?.close(); } catch { /* already closed */ }
});

// Stub contract reads — policy state ALWAYS comes from AncaSureClaims, never
// from SQLite. The stub lets us assert the join behavior deterministically.
function fakeGetPolicy(covered: Partial<Record<string, Partial<PolicyInfo>>> = {}) {
  return async (addr: string): Promise<PolicyInfo> => ({
    address: addr,
    covered: false,
    capRaw: "0",
    expiresAt: 0,
    payer: "",
    ...(covered[addr.toLowerCase()] ?? {}),
  });
}

describe("WalletStore (SQLite)", () => {
  it("adds a wallet for an owner", () => {
    expect(store.add(O1, W1)).toBe(true);
    const rows = store.list(O1);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerAddress).toBe(O1);
    expect(rows[0].walletAddress).toBe(W1);
    expect(new Date(rows[0].createdAt).getTime()).not.toBeNaN();
  });

  it("rejects duplicate (owner, wallet) pairs — unique constraint", () => {
    expect(store.add(O1, W1)).toBe(true);
    expect(store.add(O1, W1)).toBe(false);
    expect(store.list(O1)).toHaveLength(1);
  });

  it("stores multiple wallets under one owner, isolated per owner", () => {
    store.add(O1, W1);
    store.add(O1, W2);
    store.add(O1, W3);
    expect(store.count(O1)).toBe(3);
    // same wallet under a different owner is a different row
    store.add(O2, W1);
    expect(store.count(O2)).toBe(1);
    expect(store.list(O2).map((r) => r.walletAddress)).toEqual([W1]);
    // owners never leak into each other
    expect(store.list(O1).every((r) => r.ownerAddress === O1)).toBe(true);
  });

  it("persists across an API restart (close + reopen same DATABASE_PATH)", () => {
    store.add(O1, W1);
    store.add(O1, W2);
    store.close();
    const reopened = new WalletStore(dbPath); // simulates process restart
    expect(reopened.list(O1).map((r) => r.walletAddress)).toEqual([W1, W2]);
    // and dedupe still holds after restart
    expect(reopened.add(O1, W1)).toBe(false);
    reopened.close();
  });

  it("removes only the requested row", () => {
    store.add(O1, W1);
    store.add(O1, W2);
    expect(store.remove(O1, W1)).toBe(true);
    expect(store.remove(O1, W1)).toBe(false); // already gone
    expect(store.list(O1).map((r) => r.walletAddress)).toEqual([W2]);
  });
});

describe("buildWalletBook (policy state from the contract only)", () => {
  it("always includes the connected owner wallet, with live policy joined", async () => {
    store.add(O1, W1);
    const book: WalletBook = await buildWalletBook(O1, fakeGetPolicy({
      [O1]: { covered: true, capRaw: "123456789", expiresAt: 9999999999, payer: O1 },
    }), store);
    const ownerEntry = book.wallets.find((w) => w.address === O1)!;
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry.covered).toBe(true);
    expect(ownerEntry.capRaw).toBe("123456789"); // straight from the "contract"
    expect(ownerEntry.addedAt).toBeNull(); // implicit, not a stored row
    expect(ownerEntry.removable).toBe(false);
  });

  it("policy fields come from getPolicy, never from SQLite", async () => {
    store.add(O1, W2);
    const book = await buildWalletBook(O1, fakeGetPolicy({
      [W2]: { covered: true, capRaw: "777", expiresAt: 4102444800 },
    }), store);
    const w2 = book.wallets.find((w) => w.address === W2)!;
    expect(w2.covered).toBe(true);
    expect(w2.capRaw).toBe("777");
    expect(w2.expiresAt).toBe(4102444800);
    expect(w2.removable).toBe(false); // covered ⇒ not removable
    // nothing but the relationship exists in the DB — no policy columns
    const raw = fs.readFileSync(dbPath, "utf8");
    expect(raw).not.toMatch(/covered|capRaw|expiresAt|payout|premium|claim/i);
  });

  it("treats contract-read failure as unprotected without throwing", async () => {
    store.add(O1, W1);
    const book = await buildWalletBook(O1, async () => { throw new Error("RPC down"); }, store);
    const w1 = book.wallets.find((w) => w.address === W1)!;
    expect(w1.covered).toBe(false);
    expect(w1.removable).toBe(true);
  });
});
