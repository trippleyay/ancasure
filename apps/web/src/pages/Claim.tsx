import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { api, shortAddr } from "../api";
import { ConnectGate, fmtEther, fmtDate } from "./util";
import { fetchWalletBook } from "../wallets";

interface Policy { address: string; covered: boolean; capRaw: string; expiresAt: number }
interface Check { eligible?: boolean; claimant?: string; reason?: string; verifiedLossRaw?: string; payoutQuoteRaw?: string; execution?: any; evidence?: any }

export default function Claim() {
  const { address } = useAccount();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [hash, setHash] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<any>(null);

  useEffect(() => {
    if (!address) return;
    // Covered wallets from the server wallet book (may include added wallets
    // beyond the connected one).
    fetchWalletBook(address)
      .then((b) =>
        setPolicies(
          b.wallets
            .filter((w) => w.covered)
            .map((w) => ({ address: w.address, covered: true, capRaw: w.capRaw, expiresAt: w.expiresAt })),
        ),
      )
      .catch(() => {});
  }, [address]);

  async function runCheck() {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return;
    setLoading(true);
    setCheck(null);
    setClaimed(null);
    try {
      setCheck(await api<Check>("/check-eligibility", { victimTxHash: hash }));
    } catch (e) {
      setCheck({ eligible: false, reason: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function claim() {
    setClaiming(true);
    try {
      setClaimed(await api<any>("/claim", { victimTxHash: hash }));
    } catch (e) {
      setClaimed({ error: (e as Error).message });
    } finally {
      setClaiming(false);
    }
  }

  return (
    <ConnectGate>
      <div className="page-head"><h1>File a claim</h1></div>

      <h3 style={{ marginBottom: 14 }}>Select a protected wallet</h3>
      <div className="wallet-select-list" style={{ marginBottom: 20 }}>
        {policies.map((p) => (
          <label className={"wallet-row" + (selected === p.address ? " checked" : "")} key={p.address} onClick={(e) => { e.preventDefault(); setSelected(p.address); }}>
            <div className="radio" />
            <div className="wallet-meta"><div className="wallet-addr">{shortAddr(p.address)}</div><div className="wallet-sub">Coverage expires {fmtDate(p.expiresAt)}</div></div>
            <span className="wallet-status">Covered</span>
          </label>
        ))}
        {policies.length === 0 && <div className="empty-note">None of your wallets are currently covered. Protect a wallet first.</div>}
      </div>

      <h3 style={{ marginBottom: 12 }}>Transaction Hash</h3>
      <input
        style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", marginBottom: 18, border: "1px solid var(--line)", borderRadius: 10, fontFamily: "monospace" }}
        placeholder="0x… Paste the transaction hash of the trade you want AncaSure to check."
        value={hash}
        onChange={(e) => setHash(e.target.value)}
      />
      <button className="btn btn-primary" onClick={runCheck} disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash) || loading}>
        {loading ? "Verifying…" : "Check eligibility"}
      </button>

      <div style={{ marginTop: 24 }}>
        {loading && <div className="loading-card"><div className="spinner" /></div>}
        {claimed && <ClaimedView claimed={claimed} onNewClaim={() => { setClaimed(null); setCheck(null); setHash(""); }} />}
        {!claimed && check && !loading && <CheckResult check={check} onClaim={claim} claiming={claiming} />}
      </div>
    </ConnectGate>
  );
}

function CheckResult({ check, onClaim, claiming }: { check: Check; onClaim: () => void; claiming: boolean }) {
  if (!check.eligible) {
    // reason arrives as intro + "\n• " bullet lines from the API
    const [intro, ...checks] = (check.reason || "No qualifying sandwich attack was verified for this transaction.").split("\n• ");
    return (
      <div className="result-card">
        <h2>Claim Ineligible</h2>
        <p style={{ margin: 0 }}>{intro}</p>
        {checks.length > 0 && (
          <ul style={{ margin: "10px auto 0", paddingLeft: 22, textAlign: "left", maxWidth: 480, listStyle: "disc", color: "inherit" }}>
            {checks.map((c, i) => <li key={i} style={{ marginBottom: 5, fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit", color: "inherit", opacity: 0.9 }}>{c}</li>)}
          </ul>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="coverage-summary">
        <h3>Claim summary</h3>
        <div className="coverage-row"><span className="lbl">Wallet</span><span style={{ fontFamily: "monospace" }}>{shortAddr(check.claimant)}</span></div>
        <div className="coverage-row"><span className="lbl">Coverage percentage</span><span>70%</span></div>
        <div className="coverage-row total"><span className="lbl">Claim amount</span><span>{fmtEther(check.payoutQuoteRaw)} ETH</span></div>
      </div>
      <div className="evidence-panel">
        <div className="evidence-head"><h3>Verified execution</h3></div>
        <div className="evidence-rows">
          <div className="evidence-row"><span className="lbl">Actual output</span><span className="val">{check.execution ? fmtEther(check.execution.actualOutputRaw) : "—"}</span></div>
          <div className="evidence-row"><span className="lbl">Counterfactual output</span><span className="val">{check.execution ? fmtEther(check.execution.counterfactualOutputRaw) : "—"}</span></div>
          <div className="evidence-row"><span className="lbl">Verified loss</span><span className="val">{fmtEther(check.verifiedLossRaw)} ETH</span></div>
        </div>
      </div>
      <button className="btn btn-primary btn-block" onClick={onClaim} disabled={claiming}>{claiming ? "Submitting claim…" : "Claim payout"}</button>
    </>
  );
}

function ClaimedView({ claimed, onNewClaim }: { claimed: any; onNewClaim: () => void }) {
  if (claimed.error) return <div className="result-card"><h2>Claim failed</h2><p style={{ whiteSpace: "pre-line" }}>{claimed.error}</p></div>;
  return (
    <div className="result-card">
      <div className="success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l4 4L20 6"/></svg></div>
      <h2>Payout approved</h2>
      <div className="evidence-rows" style={{ textAlign: "left", maxWidth: 460, margin: "20px auto 0" }}>
        <div className="evidence-row"><span className="lbl">Verified loss</span><span className="val">{fmtEther(claimed.verifiedLossRaw)} ETH</span></div>
        <div className="evidence-row"><span className="lbl">Claim</span><span className="val">#{claimed.claimId}</span></div>
        {claimed.payoutSettled === false && <div className="evidence-row"><span className="lbl">Status</span><span className="val">Authorized — payout pending</span></div>}
        {claimed.payoutTxHash && <div className="evidence-row"><span className="lbl">Payout</span><span className="val"><a className="row-action" target="_blank" rel="noreferrer" href={`https://sepolia.etherscan.io/tx/${claimed.payoutTxHash}`}>{shortAddr(claimed.payoutTxHash)} ↗</a></span></div>}
      </div>
      <button className="btn btn-block" style={{ marginTop: 20 }} onClick={onNewClaim}>File another claim</button>
    </div>
  );
}
