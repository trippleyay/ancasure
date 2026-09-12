import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, useSwitchChain, useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { sepolia } from "wagmi/chains";
import { parseEther, formatEther } from "viem";
import { shortAddr } from "../api";
import { ConnectGate } from "./util";
import { ANCA_SURE_ABI, claimsContractAddress } from "../contract";
import { fetchWalletBook, type WalletBook } from "../wallets";

export default function Protection() {
  const { address } = useAccount();
  const [book, setBook] = useState<WalletBook | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  const uncovered = useMemo(
    () => (book?.wallets ?? []).filter((w) => !w.covered).map((w) => w.address),
    [book],
  );

  const { data: premiumRaw } = useReadContract({
    address: claimsContractAddress as `0x${string}`,
    abi: ANCA_SURE_ABI,
    functionName: "PREMIUM_PER_WALLET",
  });
  const premium = premiumRaw ? BigInt(premiumRaw as bigint) : parseEther("0.001");

  const { chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: writeHash, writeContract, isPending, error: writeError } = useWriteContract();
  const { data: receipt, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: writeHash });

  // Wallets added on the Dashboard — these are the ones you can protect.
  // Refetched after payment confirms so covered wallets drop out of the picker.
  useEffect(() => {
    setBook(null);
    if (!address) return;
    fetchWalletBook(address)
      .then(setBook)
      .catch((e) => setError((e as Error).message));
  }, [address, confirmed]);

  function toggle(a: string) {
    setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  }

  function pay() {
    if (!selected.length) return;
    // Wallet must be on Sepolia — otherwise writeContract fails silently.
    if (chainId !== sepolia.id) {
      switchChain({ chainId: sepolia.id });
      return;
    }
    writeContract({
      address: claimsContractAddress as `0x${string}`,
      abi: ANCA_SURE_ABI,
      functionName: "registerProtectionFor",
      args: [selected as `0x${string}`[]],
      value: premium * BigInt(selected.length),
    } as any);
  }

  return (
    <ConnectGate>
      <div className="page-head"><h1>Protect wallets</h1></div>
      {error && <div className="empty-note" style={{ color: "var(--red)" }}>{error}</div>}

      <div className="layout-split">
        <div>
          <h3 style={{ marginBottom: 16 }}>Select wallets to cover</h3>
          <div className="wallet-select-list">
            {uncovered.map((a) => {
              const on = selected.includes(a);
              return (
                <label className={"wallet-row" + (on ? " checked" : "")} key={a} onClick={(e) => { e.preventDefault(); toggle(a); }}>
                  <div className="checkbox">{on && <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}><path d="M4 12l4 4L20 6" /></svg>}</div>
                  <div className="wallet-meta"><div className="wallet-addr">{shortAddr(a)}</div><div className="wallet-sub">Not covered</div></div>
                  <div className="wallet-price">{formatEther(premium)} ETH / 30 days</div>
                </label>
              );
            })}
            {uncovered.length === 0 && (
              <div className="empty-note">
                {book === null
                  ? "Loading your wallets…"
                  : (book.wallets ?? []).length === 0
                    ? <>You haven’t added any wallets yet. <Link to="/dashboard" className="row-action">Add wallets on the Dashboard</Link> first, then select them here.</>
                    : "All of your wallets are already covered."}
              </div>
            )}
          </div>
        </div>

        <div className="summary-card" style={{ position: "sticky", top: 100 }}>
          <h3 style={{ marginBottom: 16 }}>Coverage summary</h3>
          <div className="summary-line"><span className="lbl">Wallets selected</span><span>{selected.length}</span></div>
          <div className="summary-line"><span className="lbl">Coverage duration</span><span>30 days</span></div>
          <div className="summary-line"><span className="lbl">Payout</span><span>70% of verified loss</span></div>
          <div className="summary-line"><span className="lbl">Payer wallet</span><span style={{ fontFamily: "monospace" }}>{shortAddr(address)}</span></div>
          <div className="summary-total"><span className="lbl">Total payment</span><span>{formatEther(premium * BigInt(Math.max(selected.length, 1)))} ETH</span></div>
          <button className="btn btn-primary btn-block" onClick={pay} disabled={!selected.length || isPending}>
            {chainId !== sepolia.id
              ? "Switch to Sepolia to protect"
              : isPending ? "Confirm in wallet…" : "Protect selected wallets"}
          </button>
          {writeError && (
            <div className="empty-note" style={{ color: "var(--red)" }}>
              {writeError.message.slice(0, 200)}
            </div>
          )}
          {confirmed && (
            <div className="empty-note" style={{ color: "var(--green)" }}>
              Coverage is active.{" "}
              {receipt?.transactionHash ? (
                <a className="row-action" target="_blank" rel="noreferrer" href={`https://sepolia.etherscan.io/tx/${receipt.transactionHash}`}>View tx</a>
              ) : "Check your wallet."}
            </div>
          )}
        </div>
      </div>
    </ConnectGate>
  );
}
