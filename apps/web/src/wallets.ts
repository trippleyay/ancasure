// The user's wallet book, stored server-side (apps/api → data/wallets.json) so
// it survives browsers and devices. Protection/paid state is joined live from
// the on-chain contract by the API — see GET/POST/DELETE /wallets in
// apps/api/src/index.ts.

import { api } from "./api";

export const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export interface WalletEntry {
  address: string;
  covered: boolean; // paid protection, still valid (from the contract)
  capRaw: string;
  expiresAt: number; // unix seconds, 0 when unprotected
  payer: string;
  addedAt: string | null; // when added to the book
  removable: boolean; // added, unprotected → may be removed
}

export interface WalletBook {
  owner: string;
  wallets: WalletEntry[];
}

export async function fetchWalletBook(owner: string): Promise<WalletBook> {
  return api<WalletBook>("/wallets?owner=" + owner);
}

export async function addWallet(owner: string, address: string): Promise<WalletBook> {
  return api<WalletBook>("/wallets", { owner, address });
}

export async function removeWallet(owner: string, address: string): Promise<WalletBook> {
  return api<WalletBook>("/wallets", { owner, address }, "DELETE");
}