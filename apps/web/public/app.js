/**
 * AncaSure web app — shared client helper.
 * Loaded by landing / dashboard / protection / claim pages.
 * Design lives in the HTML files; this file only provides behavior.
 */
(function () {
  const API = "http://localhost:3000";
  const SESSION_KEY = "ancasure_session";

  const Session = {
    get() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY)) ?? null; }
      catch { return null; }
    },
    set(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); },
    clear() { localStorage.removeItem(SESSION_KEY); },
    require() {
      const s = this.get();
      if (!s || !s.address) { window.location.href = "ancasure-landing.html"; throw new Error("not connected"); }
      return s;
    },
    addWallet(addr) {
      const s = this.require();
      addr = addr.toLowerCase();
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error("invalid address");
      if (!s.wallets.some((w) => w.toLowerCase() === addr)) s.wallets.push(addr);
      this.set(s);
      return s;
    },
  };

  async function api(path, body) {
    const r = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? j.reason ?? JSON.stringify(j));
    return j;
  }

  // Wallet connection: injected provider first, WalletConnect QR fallback.
  let health = null;
  async function getHealth() { return health ?? (health = await api("/health")); }

  async function connectWallet() {
    const h = await getHealth();
    if (window.ethereum) {
      const p = new ethers.BrowserProvider(window.ethereum);
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      return signer.address;
    }
    const WCPkg = window["@walletconnect/ethereum-provider"] ?? window.WalletConnectEthereumProvider;
    if (!WCPkg) throw new Error("WalletConnect library failed to load");
    if (!h.wcProjectId) throw new Error("WalletConnect not configured (WALLETCONNECT_PROJECT_ID missing on API)");
    const WCProvider = WCPkg.EthereumProvider ?? WCPkg;
    const wc = await WCProvider.init({
      projectId: h.wcProjectId,
      chains: [11155111],
      rpcMap: { 11155111: "https://rpc.sepolia.org" },
      showQrModal: true,
      metadata: { name: "AncaSure", description: "Sandwich-attack insurance", url: "https://ancasure.app", icons: [] },
    });
    const p = new ethers.BrowserProvider(wc, undefined, { staticNetwork: new ethers.Network("sepolia", 11155111) });
    const signer = await p.getSigner();
    return signer.address;
  }

  /** BrowserProvider for the connected wallet (injected only; WC sessions must reconnect). */
  async function getProvider() {
    if (!window.ethereum) throw new Error("Open the app in a browser with MetaMask to sign transactions");
    return new ethers.BrowserProvider(window.ethereum);
  }

  function short(addr) { return addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : ""; }
  function fmtEth(wei) { return ethers.formatEther(BigInt(wei)); }
  function fmtDate(unixSec) {
    return new Date(unixSec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  window.AncaSure = { API, Session, api, connectWallet, getProvider, getHealth, short, fmtEth, fmtDate };

  // "Disconnect" links clear the session before navigating to the landing page.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.disconnect-btn');
    if (a) Session.clear();
  });
})();