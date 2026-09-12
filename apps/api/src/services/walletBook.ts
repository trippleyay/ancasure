/**
 * Owner's wallet book: SQLite rows joined with LIVE on-chain policy state.
 *
 * Policy/coverage/expiry/cap NEVER touch SQLite — they come from the
 * AncaSureClaims contract via getPolicy(), so they can never go stale.
 * The connected owner wallet always appears automatically; added wallets come
 * from the walletStore table.
 */
import { getPolicy, type PolicyInfo } from "./claims.js";
import { walletStore, type WalletStore } from "./walletStore.js";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export interface WalletBookEntry extends PolicyInfo {
  addedAt: string | null;
  /** An added, unprotected wallet may be removed; paid coverage must run out. */
  removable: boolean;
}

export interface WalletBook {
  owner: string;
  wallets: WalletBookEntry[];
}

/**
 * Build the owner's wallet book. `getPolicyFn` is injectable for tests —
 * production always passes the real contract read.
 */
export async function buildWalletBook(
  ownerLc: string,
  getPolicyFn: (addr: string) => Promise<PolicyInfo> = getPolicy,
  store: WalletStore = walletStore,
): Promise<WalletBook> {
  const rows = store.list(ownerLc).filter((r) => ADDR_RE.test(r.walletAddress));
  const wallets: WalletBookEntry[] = [];

  for (const a of [...new Set([ownerLc, ...rows.map((r) => r.walletAddress)])].slice(0, 25)) {
    const row = rows.find((r) => r.walletAddress === a);
    let policy: PolicyInfo = { address: a, covered: false, capRaw: "0", expiresAt: 0, payer: "" };
    try {
      policy = await getPolicyFn(a);
    } catch {
      /* RPC down / contract not deployed yet — surface as unprotected */
    }
    wallets.push({
      ...policy,
      addedAt: row?.createdAt ?? null,
      removable: a !== ownerLc && !policy.covered,
    });
  }

  return { owner: ownerLc, wallets };
}
