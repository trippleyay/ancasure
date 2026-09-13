export default function Terms() {
  return (
    <div className="legal-page">
      <div className="wrap">
        <h1>AncaSure Terms</h1>
        <p className="legal-date">Last updated: September 13, 2026</p>
        <p>These terms apply to your use of the AncaSure interface, API, and related smart contracts. By using AncaSure, you accept these terms.</p>

        <h2>1. Introduction</h2>
        <p>AncaSure is a decentralized insurance prototype for DEX traders. It is designed to provide coverage against qualifying losses caused by sandwich attacks.</p>
        <p>AncaSure does not prevent sandwich attacks. It provides a claim process for verified losses that meet the published eligibility rules.</p>
        <p>These terms explain how coverage works, how claims are assessed, and what risks remain.</p>

        <h2>2. Prototype and testnet status</h2>
        <p>AncaSure is a prototype. The deployed experience referenced in the repository is a testnet/hackathon prototype running on Sepolia.</p>
        <p>Testnet tokens and testnet activity do not have real monetary value. Do not treat testnet ETH or testnet transactions as real funds or real insurance settlements.</p>
        <p>The prototype may be incomplete, unstable, or changed at any time.</p>

        <h2>3. Eligibility and wallet control</h2>
        <p>You connect a wallet to use the interface. You are responsible for the addresses you choose to protect.</p>
        <p>You may add wallet addresses to your dashboard to track them and request protection for them. Adding a wallet does not by itself create coverage. Coverage is created only when a premium is paid and the policy is registered on chain.</p>
        <p>If you file a claim for a protected wallet, you must have appropriate control or authorization for that wallet. AncaSure does not verify ownership of every address you enter. You should not add addresses you do not control.</p>

        <h2>4. Coverage</h2>

        <h3>4.1 Coverage period</h3>
        <p>Coverage is provided in 30-day periods. Each premium payment covers the selected wallet addresses for one 30-day period starting when the premium is paid.</p>

        <h3>4.2 How coverage begins</h3>
        <p>Coverage begins when the premium is paid and the policy is registered on the AncaSureClaims contract. The contract stores the coverage start and expiry.</p>

        <h3>4.3 How coverage ends</h3>
        <p>Coverage ends when the policy expiry is reached. After expiry, the wallet is no longer covered unless a new premium is paid.</p>

        <h3>4.4 No automatic renewal</h3>
        <p>Coverage does not renew automatically. You must pay a new premium to extend or restart coverage.</p>

        <h3>4.5 Premium</h3>
        <p>The premium is paid by the connected payer wallet. The premium amount in this prototype is 0.001 ether per wallet per 30-day coverage period.</p>
        <p>This amount is set by the current contract implementation. It may change in a future version.</p>

        <h3>4.6 Policy cap</h3>
        <p>Each policy has a cap. The cap is the maximum payout for a single claim on that policy. If no cap is set when coverage is registered, the policy uses the contract's default cap.</p>
        <p>The default cap in the current implementation is 0.05 ether.</p>

        <h3>4.7 Verified-loss rule</h3>
        <p>A qualifying claim covers 70% of the verified loss, up to the policy cap.</p>
        <p>The payout is calculated as:</p>
        <ul>
          <li>payout = min(verified loss × 70 / 100, policy cap)</li>
        </ul>
        <p>The same ratio and cap rules are used both off-chain for quotes and on-chain for settlement, so the quoted amount and the settled amount should match.</p>

        <h2>5. Claim rules</h2>
        <p>A claim must satisfy the published eligibility conditions. Not every DEX transaction qualifies.</p>
        <p>A claim may be considered only if:</p>
        <ul>
          <li>the wallet had active coverage at the time of the loss</li>
          <li>the loss is tied to a specific transaction</li>
          <li>the transaction is a sandwich attack that meets the detection rules</li>
          <li>the transaction evidence is verified through the external-chain verification process</li>
        </ul>
        <p>Transaction evidence is independently checked before a claim can proceed. The evidence verification uses Creditcoin/Attestcoin infrastructure to verify external-chain transaction data used in claim assessment.</p>
        <p>Creditcoin verifies evidence. It does not determine whether a wallet is insured. Insurance status is AncaSure policy state.</p>
        <p>A claim is not automatic. Meeting some of the conditions above does not guarantee a payout.</p>

        <h2>6. Loss calculation</h2>
        <p>When a claim is assessed, the system compares the actual trade execution with a reconstructed outcome without the attack.</p>
        <p>In plain terms, the system tries to estimate what the trade would have produced if the sandwich attack had not happened, and compares that with what the trade actually produced. The difference is the verified loss used for the claim.</p>
        <p>The current implementation focuses on Uniswap V2-style pools on Ethereum Sepolia. It may not support every AMM, every chain, or every trade type.</p>

        <h2>7. No guarantee</h2>
        <p>AncaSure does not promise that every loss will be reimbursed.</p>
        <p>A payout depends on:</p>
        <ul>
          <li>active coverage at the time of the loss</li>
          <li>the policy cap</li>
          <li>the 70% verified-loss rule</li>
          <li>the published eligibility conditions</li>
          <li>successful verification of the transaction evidence</li>
        </ul>

        <h2>8. Blockchain risks</h2>
        <p>AncaSure depends on public blockchains and related infrastructure. Those systems have risks.</p>

        <h3>8.1 Smart contract risk</h3>
        <p>The AncaSureClaims contract is code. Code can contain bugs, unintended behavior, or vulnerabilities. Coverage and claims depend on the contract working as intended.</p>

        <h3>8.2 Network congestion and transaction failure</h3>
        <p>Blockchain transactions can fail, be delayed, or be included in an unexpected order. Coverage registration, claim submission, and payouts all depend on transactions being included as expected.</p>

        <h3>8.3 Chain reorganizations</h3>
        <p>Blockchains can reorganize. A transaction that appeared confirmed may later be removed or reordered. This can affect claim evidence, ordering, and the state of coverage at a given time.</p>

        <h3>8.4 Third-party protocol risk</h3>
        <p>AncaSure uses external protocols and services, including RPC providers, wallet connection services, and external-chain attestation infrastructure. Those services may have outages, changes, or limitations.</p>

        <h3>8.5 Testnet instability</h3>
        <p>When used on testnets, the service may be affected by testnet instability, faucet issues, low liquidity, or other testnet-specific problems.</p>

        <h2>9. Prohibited behavior</h2>
        <p>You may not:</p>
        <ul>
          <li>attempt to manufacture or manipulate claims</li>
          <li>submit false or altered transaction evidence</li>
          <li>abuse the claim system</li>
          <li>attack the service or its infrastructure</li>
          <li>attempt to bypass coverage limits, caps, or eligibility rules</li>
          <li>use the service in a way that interferes with other users or with the underlying protocols</li>
        </ul>
        <p>If AncaSure determines that a claim or activity is abusive, AncaSure may reject the claim, reverse action where possible, or restrict access.</p>

        <h2>10. Intellectual property</h2>
        <p>The AncaSure software in this repository is licensed under the MIT License.</p>
        <p>Copyright (c) 2026 AncaSure contributors.</p>
        <p>The MIT License permits use, copying, modification, merging, publishing, distribution, sublicensing, and selling of copies, subject to the license terms. The full license text is included in the repository.</p>

        <h2>11. Disclaimers</h2>
        <p>AncaSure is provided as a prototype. It is not a regulated insurance product, and this document is not legal, financial, or tax advice.</p>
        <p>The on-chain contract and the interface may contain bugs or be incomplete. Use at your own risk.</p>
        <p>No one involved in AncaSure guarantees any payout, any coverage outcome, or any specific result from using the service.</p>

        <h2>12. Changes and termination</h2>
        <p>These terms may change over time. Updates may be made to reflect product changes, bug fixes, or legal review.</p>
        <p>If the terms change, the updated terms apply to continued use of the service. You are responsible for reviewing the current terms.</p>
        <p>AncaSure may suspend or stop providing access to the service at any time, with or without notice, especially while it remains a prototype.</p>

        <h2>13. Contact</h2>
        <p>If you have questions about these terms, contact:</p>
        <p><a href="mailto:trippleyay.aj@gmail.com" style={{ color: "var(--blue)", textDecoration: "underline" }}>Email</a></p>

        <h2>14. Governing law</h2>
        <p>These terms are governed by:</p>
        <p>[GOVERNING LAW / JURISDICTION]</p>
        <p>If a jurisdiction requires different terms, those requirements apply to users in that jurisdiction.</p>
        <p>Even when a loss occurs, a payout may be reduced by the cap, reduced by the 70% rule, or rejected if the claim does not meet the eligibility conditions.</p>
      </div>
    </div>
  );
}
