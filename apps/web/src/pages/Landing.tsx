import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Lottie, { LottieRefCurrentProps } from "lottie-react";
import heroLottieData from "../heroLottie.json";
import Logo from "../components/Logo";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#coverage", label: "Coverage" },
  { href: "#why", label: "Why AncaSure" },
  { href: "#verify", label: "Verification" },
];

function Icon({ d, color = "var(--blue)" }: { d: string[]; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

function GetCovered({ big }: { big?: boolean }) {
  const nav = useNavigate();
  return (
    <ConnectButton.Custom>
      {({ account, openConnectModal }) => (
        <button
          className="btn btn-primary"
          style={big ? { padding: "18px 38px", fontSize: 17 } : { padding: "12px 24px", fontSize: 14 }}
          onClick={() => (account ? nav("/dashboard") : openConnectModal())}
        >
          {account ? "Open dashboard" : "Get covered"}
        </button>
      )}
    </ConnectButton.Custom>
  );
}

export default function Landing() {
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);
  const heroCtaRef = useRef<HTMLDivElement | null>(null);
  const [heroCtaVisible, setHeroCtaVisible] = useState(true);

  useEffect(() => {
    lottieRef.current?.setSpeed(0.25);
  }, []);

  useEffect(() => {
    const el = heroCtaRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setHeroCtaVisible(entry.isIntersecting),
      { rootMargin: "-80px 0px 0px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <header>
        <div className="nav-inner">
          <a href="/" className="logo"><Logo />AncaSure</a>
          <nav className="links">
            {NAV.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
          </nav>
          <div className={`nav-cta${heroCtaVisible ? "" : " show"}`}><GetCovered /></div>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-bg" aria-hidden>
          <Lottie
            lottieRef={lottieRef}
            animationData={heroLottieData}
            loop
            autoplay
            rendererSettings={{ preserveAspectRatio: "xMidYMid slice" }}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        <div className="wrap hero-inner">
          <h1>Trade normally.<br />We've got you if it goes <em>sideways</em>.</h1>
          <p className="sub">
            AncaSure covers your wallet against sandwich attacks. Trade on your usual DEX and get paid if you suffer a verified loss.
          </p>
          <div className="hero-ctas" ref={heroCtaRef}>
            <GetCovered big />
            <a href="#how" className="btn btn-ghost">See how it works</a>
          </div>
          <p className="hero-note">No auto-renewal. Each payment covers 30 days. Cancel anytime by simply not renewing.</p>
        </div>
      </section>

      <section id="how">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">How coverage works</div>
            <h2>Five simple steps. Claim when something goes wrong.</h2>
          </div>
          <div className="flow">
            {[
              ["I", "Get covered", "Connect a wallet, choose the addresses you want to protect, and pay for 30 days of coverage."],
              ["II", "Trade normally", "Use your usual DEX. AncaSure does not change how you trade."],
              ["III", "A sandwich attack happens", "A qualifying sandwich attack affects a covered trade."],
              ["IV", "We check the claim", "AncaSure verifies the external transaction evidence and calculates the loss caused by the attack."],
              ["V", "Claim your loss", "If the claim meets the coverage rules, you can claim 70% of the verified loss, up to the policy cap."],
            ].map(([num, title, desc]) => (
              <div className="flow-step" key={num}>
                <div className="flow-num-wrap">
                  <span className="flow-num">{num}</span>
                </div>
                <h4>{title}</h4>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="coverage">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Coverage</div>
            <h2>Clear coverage. Simple claim rules.</h2>
          </div>
          <div className="cards-grid">
            {[
              ["Protect your wallets", "Add the wallets you trade from and pay once for 30 days of coverage.", ["M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"]],
              ["Verified loss", "AncaSure compares your real execution with what the trade would have returned without the sandwich attack.", ["M3 3v18h18", "M7 15l4-6 4 3 5-8"]],
              ["70% coverage", "A qualifying claim covers 70% of the verified loss, subject to the policy cap.", ["M12 1v22", "M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"]],
            ].map(([h, p, d]) => (
              <div className="glass-card centered" key={h as string}>
                <div className="card-icon" style={{ background: "var(--blue-tint)" }}>
                  <Icon d={d as string[]} />
                </div>
                <h4>{h}</h4>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="why">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Why AncaSure</div>
            <h2>Insurance for the trades you already make</h2>
          </div>
          <div className="why-grid">
            {[
              ["Trade the way you already do", "No special trading setup or DEX restriction is required for the insurance product."],
              ["Claims are independently checked", "Creditcoin's Attestcoin infrastructure verifies the external-chain transaction evidence used to assess a claim."],
              ["We measure the actual loss", "AncaSure reconstructs what the trade would have returned without the front-run and compares it with the real execution."],
              ["Know how your claim was calculated", "The evidence, loss calculation, payout percentage, and policy cap are explicit rather than hidden behind a manual decision."],
            ].map(([h, p]) => (
              <div className="why-card" key={h}>
                <h4>{h}</h4>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="verify">
        <div className="wrap">
          <div className="verify-wrap">
            <div className="verify-copy">
              <div className="eyebrow">Verification</div>
              <h2>Evidence checked before a claim is approved</h2>
              <p>The attacker's front-run, your transaction, and the back-run are each verified through Creditcoin's Attestcoin infrastructure before a claim can proceed.</p>
              <p>AncaSure then calculates the verified loss from pool state. Insurance policy state, claim rules, and payout are handled by AncaSure's claims contract.</p>
            </div>
            <div className="verify-chain">
              {[
                ["External chain", "Your trade happens on the DEX and chain you already use.", ["M3 3h18v18H3z"]],
                ["Creditcoin/Attestcoin", "Transaction evidence is independently verified before a claim can proceed.", ["M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"]],
                ["AncaSure", "Verified loss is calculated and your payout is issued.", ["M20 6L9 17l-5-5"]],
              ].map(([label, desc, d], i) => (
                <div key={label as string}>
                  <div className="chain-node">
                    <div className="dot"><Icon d={d as string[]} color="#0A5CFF" /></div>
                    <div><div className="label">{label}</div><div className="desc">{desc}</div></div>
                  </div>
                  {i < 2 && <div className="chain-line" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="final-cta">
            <h2>Trade with coverage in place</h2>
            <p>Set up 30 days of coverage for the wallets you trade from. If a qualifying sandwich attack causes a covered loss, AncaSure gives you a clear path to a claim.</p>
            <div style={{ display: "inline-flex" }}><GetCovered /></div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="footer-top">
            <div className="footer-brand">
              <a href="#top" className="logo"><Logo />AncaSure</a>
              <p>Insurance for losses caused by verified sandwich attacks.</p>
              <p className="footer-brand-sub">AncaSure checks the external transaction evidence before a claim is approved.</p>
            </div>
            <div className="footer-col"><h5>Product</h5><ul><li><a href="#how">How it works</a></li><li><a href="#coverage">Coverage</a></li><li><a href="#verify">Verification</a></li></ul></div>
            <div className="footer-col"><h5>Legal</h5><ul><li><a href="/terms">Terms</a></li><li><a href="/privacy">Privacy</a></li></ul></div>
          </div>
          <div className="footer-bottom">
            <div>&copy; 2026 AncaSure. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </>
  );
}
