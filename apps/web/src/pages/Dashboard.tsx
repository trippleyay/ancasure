import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { api, shortAddr } from "../api";
import { ConnectGate, fmtEther } from "./util";
import { fetchWalletBook, addWallet, removeWallet, ADDR_RE, type WalletBook } from "../wallets";

interface ClaimRow { id: string; kind: string; claimant: string; amountRaw: string; txHash?: string; verifiedLossRaw?: string }

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [book, setBook] = useState<WalletBook | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [input, setInput] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState("");
  const [showPromo, setShowPromo] = useState(true);

  // The wallet book lives on the server (connected wallet + ones added here).
  useEffect(() => {
    setBook(null);
    if (!address) return;
    fetchWalletBook(address)
      .then(setBook)
      .catch((e) => setError((e as Error).message));
  }, [address]);

  useEffect(() => {
    if (!isConnected || !address) return;
    api<{ claims: ClaimRow[] }>("/claims-history?address=" + address.toLowerCase())
      .then((r) => setClaims(r.claims))
      .catch(() => {});
  }, [address, isConnected]);

  async function handleAdd() {
    if (!address) return;
    const a = input.trim().toLowerCase();
    if (!ADDR_RE.test(a)) {
      setAddError("Enter a valid 0x… wallet address.");
      return;
    }
    if (book?.wallets.some((w) => w.address === a)) {
      setAddError("That wallet is already in your list.");
      return;
    }
    setAdding(true);
    try {
      setBook(await addWallet(address, a));
      setShowAdd(false);
      setInput("");
      setAddError("");
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  // Only added, unprotected wallets can be removed (enforced by the API too).
  async function handleRemove(a: string) {
    if (!address || removing) return;
    setRemoving(a);
    try {
      setBook(await removeWallet(address, a));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemoving("");
    }
  }

  const entries = book?.wallets ?? [];
  const covered = useMemo(() => entries.filter((w) => w.covered), [book]);
  const expiringSoon = useMemo(
    () => covered.filter((p) => p.expiresAt - Date.now() / 1000 < 7 * 86400),
    [covered],
  );

  return (
    <ConnectGate>
      <div className="page-head">
        <div><h1>Dashboard</h1><p>Coverage for your connected wallet</p></div>
        <button className="btn btn-primary" onClick={() => { setShowAdd((s) => !s); setInput(""); setAddError(""); }}>
          {showAdd ? "Close" : "+ Add wallet"}
        </button>
      </div>

      {showAdd && (
        <div className="panel" style={{ padding: 18, marginBottom: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Add a wallet</h3>
          <p style={{ margin: "0 0 14px", color: "var(--ink-soft)", fontSize: 14 }}>
            Paste any wallet address to track it here. You can then protect it from the Protect screen.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              autoFocus
              value={input}
              onChange={(e) => { setInput(e.target.value); setAddError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              placeholder="0x… wallet address to add"
              style={{ flex: 1, minWidth: 0, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, fontFamily: "monospace" }}
            />
            <button className="btn btn-primary" onClick={handleAdd} disabled={adding || !ADDR_RE.test(input.trim())}>{adding ? "Adding…" : "Add wallet"}</button>
            <button className="btn btn-ghost" onClick={() => { setShowAdd(false); setAddError(""); }}>Cancel</button>
          </div>
          {addError && <div className="empty-note" style={{ color: "var(--red)", marginTop: 10 }}>{addError}</div>}
        </div>
      )}
      {error && <div className="empty-note" style={{ color: "var(--red)" }}>{error}</div>}

      <div className="summary-grid">
        {[
          [String(covered.length), "Protected wallets"],
          [String(covered.length), "Active coverage"],
          [String(expiringSoon.length), "Expiring in 7 days"],
          [String(claims.filter((c) => c.kind === "authorized").length), "Claims"],
        ].map(([n, l]) => (
          <div className="summary-card" key={l}>
            <div className="num">{n}</div>
            <div className="lbl">{l}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head"><div><h3>My wallets</h3></div></div>
        <table>
          <thead><tr><th>Wallet</th><th>Status</th><th>Coverage expires</th><th></th></tr></thead>
          <tbody>
            {entries.map((w) => {
              const isConn = w.address === address!.toLowerCase();
              return (
                <tr key={w.address}>
                  <td>
                    <div className="addr-cell">{shortAddr(w.address)}{isConn && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink-soft)" }}>(connected)</span>}</div>
                  </td>
                  <td><span className={"badge " + (w.covered ? "badge-covered" : "badge-notcovered")}>{w.covered ? "Covered" : "Not covered"}</span></td>
                  <td>{w.covered && w.expiresAt ? new Date(w.expiresAt * 1000).toLocaleDateString() : "—"}</td>
                  <td>
                    {w.removable && (
                      <button className="row-action" disabled={removing === w.address} onClick={() => handleRemove(w.address)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        {removing === w.address ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {book === null && <tr><td colSpan={4} className="empty-note">Loading your wallets…</td></tr>}
            {book !== null && entries.length === 0 && <tr><td colSpan={4} className="empty-note">No wallets yet — use “+ Add wallet” to add one.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-head"><div><h3>Claims history</h3></div></div>
        <table>
          <thead><tr><th>Wallet</th><th>Status</th><th>Payout</th><th>Explorer</th></tr></thead>
          <tbody>
            {claims.length === 0 && <tr><td colSpan={4} className="empty-note">No claims yet.</td></tr>}
            {claims.map((c) => (
              <tr key={c.id + c.txHash}>
                <td><div className="addr-cell">{shortAddr(c.claimant)}</div></td>
                <td><span className={"badge " + (c.kind === "paid" ? "badge-paid" : "badge-eligible")}>{c.kind === "paid" ? "Paid" : "Eligible"}</span></td>
                <td>{fmtEther(c.amountRaw)} ETH</td>
                <td>{c.txHash ? <a className="row-action" target="_blank" rel="noreferrer" href={`https://sepolia.etherscan.io/tx/${c.txHash}`}>View</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPromo && (
        <div className="promo-bar">
          <span>
            simulate a live sandwich attack on Sepolia testnet.{" "}
            <a href="https://ancasure.onrender.com/mev-demo" target="_blank" rel="noreferrer">
              Open MEV Creator →
            </a>
          </span>
          <button className="promo-dismiss" onClick={() => setShowPromo(false)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </ConnectGate>
  );
}