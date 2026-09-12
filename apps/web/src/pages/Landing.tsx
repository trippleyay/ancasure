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

  // Slow the background animation down once the player is ready.
  useEffect(() => {
    lottieRef.current?.setSpeed(0.25);
  }, []);

  // The nav "Get covered" button only appears once the hero CTA is out of view.
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
            AncaSure covers your wallet against verifiable sandwich attacks. Trade on your
            usual DEX, and if a verified attack causes you a loss, you get paid.
          </p>
          <div className="hero-ctas" ref={heroCtaRef}>
            <GetCovered big />
            <a href="#how" className="btn btn-ghost">See how it works</a>
          </div>
          <p className="hero-note">No auto-renewal. 30-day coverage periods. Cancel anytime by simply not renewing.</p>
        </div>
      </section>
<section id="how">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">How it works</div>
            <h2>From wallet to payout, five steps</h2>
            <p>You keep trading exactly the way you already do. AncaSure watches for the one thing that matters: whether a verifiable sandwich attack cost you money.</p>
          </div>
          <div className="flow">
            {[
              ["Get covered", "Connect a wallet, select which addresses to protect, and pay for 30 days of coverage.", ["M4 12l4 4L20 6"]],
              ["Trade normally", "Use your usual DEX. Nothing changes about how you trade.", ["M3 12h4l3 8 4-16 3 8h4"]],
              ["Attack happens", "A sandwich attack hits your trade on an external EVM chain.", ["M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"]],
              ["We verify", "Creditcoin's Attestcoin infrastructure cryptographically proves the attack.", ["M3 3v18h18", "M7 15l4-6 4 3 5-8"]],
              ["You get paid", "70% of your verified loss, up to your policy cap, paid automatically.", ["M12 1v22", "M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"]],
            ].map(([h, p, d]) => (
              <div className="flow-step" key={h as string}>
                <div className="flow-icon"><Icon d={d as string[]} /></div>
                <h4>{h}</h4>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="coverage">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Coverage</div>
            <h2>Simple, transparent protection</h2>
            <p>One flat premium per wallet. One coverage period. One payout formula. No fine print.</p>
          </div>
          <div className="cards-grid">
            {[
              ["Register & protect", "Add any wallet you trade from and pay a flat premium per wallet for 30 days of coverage.", ["M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"]],
              ["Verified loss", "If sandwiched, the counterfactual output is reconstructed exactly and compared with your real execution.", ["M3 3v18h18", "M7 15l4-6 4 3 5-8"]],
              ["70% payout", "The payout is 70% of the verified loss, capped by your policy cap.", ["M12 1v22", "M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"]],
            ].map(([h, p, d]) => (
              <div className="glass-card" key={h as string}>
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
            <h2>MEV protection you don't have to think about</h2>
            <p>We don't prevent attacks — we make sure they can't hurt you financially.</p>
          </div>
          <div className="why-grid">
            {[
              ["Retroactive, not preventive", "No proxies, no wrapped tokens, no trading restrictions. You keep full custody and trade exactly as before."],
              ["Cryptographic verification", "Every claim is backed by proof verified on Creditcoin — not by our word."],
              ["Counterfactual precision", "We reconstruct exactly what your trade would have returned without the attack, using the pool's own state."],
              ["Payout you can audit", "The verified loss, the cap, and the payout formula are all on-chain and deterministic."],
            ].map(([h, p]) => (
              <div className="why-card" key={h}>
                <div className="why-icon"><Icon d={["M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"]} color="#0A5CFF" /></div>
                <div><h4>{h}</h4><p>{p}</p></div>
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
              <h2>Independently proven, before any payout</h2>
              <p>The attacker's front-run, your victim transaction, and the back-run are each cryptographically verified on Creditcoin before a claim is eligible.</p>
              <p>The verified loss is then computed deterministically from pool state — never from user input.</p>
            </div>
            <div className="verify-chain">
              {[
                ["Front-run proof", "Attacker's opening transaction"],
                ["Victim transaction", "Your swap, with full receipt"],
                ["Back-run proof", "Attacker's closing transaction"],
                ["Counterfactual", "What you would have received"],
              ].map(([label, desc], i) => (
                <div key={label}>
                  <div className="chain-node">
                    <div className="dot"><Icon d={["M3 3h18v18H3z"]} color="#0A5CFF" /></div>
                    <div><div className="label">{label}</div><div className="desc">{desc}</div></div>
                  </div>
                  {i < 3 && <div className="chain-line" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="final-cta">
            <h2>Ready to trade with a safety net?</h2>
            <p>Coverage takes minutes to set up and protects every trade you make for the next 30 days.</p>
            <div style={{ display: "inline-flex" }}><GetCovered /></div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="footer-top">
            <div className="footer-brand">
              <a href="#top" className="logo"><Logo />AncaSure</a>
              <p>Retroactive insurance against verified sandwich-attack losses. Settled via Creditcoin.</p>
            </div>
            <div className="footer-col"><h5>Product</h5><ul><li><a href="#how">How it works</a></li><li><a href="#coverage">Coverage</a></li><li><a href="#verify">Verification</a></li></ul></div>
            <div className="footer-col"><h5>Learn</h5><ul><li><a href="#why">Why AncaSure</a></li><li><a href="#coverage">Policy cap</a></li><li><a href="#how">Claim rules</a></li></ul></div>
            <div className="footer-col"><h5>Legal</h5><ul><li><a href="#verify">Terms</a></li><li><a href="#coverage">Privacy</a></li></ul></div>
          </div>
          <div className="footer-bottom">
            <div>© 2026 AncaSure. All rights reserved.</div>
            <div className="footer-legal"><a href="#how">Terms</a><a href="#coverage">Privacy</a></div>
          </div>
        </div>
      </footer>
    </>
  );
}
