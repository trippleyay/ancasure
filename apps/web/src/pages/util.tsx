import { ReactNode } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function fmtEther(wei?: string | number | bigint) {
  try {
    return (Number(BigInt(wei ?? 0)) / 1e18).toFixed(4);
  } catch {
    return "0.0000";
  }
}

export function fmtDate(unixSec?: number) {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ConnectCta({ big }: { big?: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, openConnectModal, mounted }) => {
        const ready = mounted && account;
        return (
          <button className="btn btn-primary" onClick={openConnectModal} style={big ? { padding: "18px 38px", fontSize: 17 } : undefined}>
            {ready ? "Switch wallet" : "Connect wallet"}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

export function ConnectGate({ children }: { children: ReactNode }) {
  return (
    <ConnectButton.Custom>
      {({ account, openConnectModal, mounted }) => {
        if (mounted && account) return <>{children}</>;
        return (
          <div className="connect-wrap">
            <h2>Connect your wallet</h2>
            <p style={{ color: "var(--ink-soft)" }}>Connect a wallet to view your coverage and file claims.</p>
            <button className="btn btn-primary" onClick={openConnectModal}>Connect wallet</button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
