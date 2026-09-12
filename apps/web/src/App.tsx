import { useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";
import { api, shortAddr } from "./api";
import { setClaimsAddress } from "./contract";
import Logo from "./components/Logo";
import Dashboard from "./pages/Dashboard";
import Protection from "./pages/Protection";
import Claim from "./pages/Claim";
import Landing from "./pages/Landing";

function Sidebar() {
  const { address } = useAccount();
  const loc = useLocation();
  const links = [
    { to: "/dashboard", label: "Dashboard", icon: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" },
    { to: "/protect", label: "Protect wallets", icon: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4zM9 12l2 2 4-4" },
    { to: "/claim", label: "File a claim", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" },
  ];
  return (
    <aside className="sidebar">
      <Link to="/" className="logo"><Logo />AncaSure</Link>
      <nav className="side-nav">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className={`side-link${loc.pathname === l.to ? " active" : ""}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={l.icon} /></svg>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="side-wallet">
        <div className="avatar" />
        <div className="info">
          <div className="addr">{address ? shortAddr(address) : "Not connected"}</div>
          <div className="tag">{address ? "Connected wallet" : "Click Connect"}</div>
        </div>
        <Link to="/" title="Back to landing page" style={{ marginLeft: "auto", opacity: 0.65, display: "flex", padding: 6, borderRadius: 8, cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.65")}>
          {/* door-out / exit */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    api<{ claimsContractAddress?: string }>("/health").then((h) => {
      if (h.claimsContractAddress) setClaimsAddress(h.claimsContractAddress);
    }).catch(() => {});
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
      <Route path="/protect" element={<Layout><Protection /></Layout>} />
      <Route path="/claim" element={<Layout><Claim /></Layout>} />
    </Routes>
  );
}
