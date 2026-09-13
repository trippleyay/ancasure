export default function Privacy() {
  return (
    <div className="legal-page">
      <div className="wrap">
        <h1>AncaSure Privacy Notice</h1>
        <p className="legal-date">Last updated: September 13, 2026</p>
        <p>This notice explains what information AncaSure collects, how it is used, and what remains public on the blockchain.</p>

        <h2>1. Information collected</h2>
        <p>AncaSure collects only the information needed to run the current prototype.</p>
        <p>Depending on how you use the service, this may include:</p>
        <ul>
          <li>the wallet address you connect to the interface</li>
          <li>wallet addresses you add to your dashboard</li>
          <li>transaction hashes you submit for claim assessment</li>
          <li>claim-related information, such as the protected wallet and the transaction being claimed</li>
          <li>technical logs created by the API server</li>
          <li>the relationship between your connected wallet and any wallets you add, stored in the application database</li>
        </ul>
        <p>AncaSure does not use cookies in the current prototype.</p>
        <p>AncaSure does not use analytics in the current prototype.</p>
        <p>If a future version adds cookies, analytics, or other tracking, this notice will be updated.</p>

        <h2>2. Why information is used</h2>
        <p>Your information is used to:</p>
        <ul>
          <li>provide the dashboard and claim interface</li>
          <li>remember which wallets you have added</li>
          <li>check coverage status</li>
          <li>process claims</li>
          <li>prevent abuse of the claim system</li>
          <li>debug and maintain the service</li>
          <li>respond to security issues</li>
        </ul>

        <h2>3. Blockchain information</h2>
        <p>Blockchain transactions are public.</p>
        <p>Wallet addresses, transaction hashes, and on-chain activity may be visible on public networks such as Ethereum Sepolia. Anyone can view them using a block explorer.</p>
        <p>Coverage registration, claim submission, and payouts may all be visible on chain. The information stored on chain is not controlled by AncaSure and may be seen by others.</p>
        <p>Do not rely on the blockchain for privacy. If you do not want an address or transaction to be public, do not use it with AncaSure.</p>

        <h2>4. Application database</h2>
        <p>The API server stores a small amount of information off-chain in a SQLite database.</p>
        <p>The database is used to record which connected owner added which wallet address, and when. That relationship is stored so it can persist across browsers and devices.</p>
        <p>The database does not store coverage status, expiry, premiums, payout amounts, or claim eligibility. That information is read live from the AncaSureClaims contract.</p>
        <p>Technical claim activity may also be recorded in a separate append-only claims log file used by the API server.</p>

        <h2>5. Third-party services</h2>
        <p>The prototype uses third-party services to function. These may include:</p>
        <ul>
          <li>an Ethereum RPC provider, used to read and send blockchain data</li>
          <li>the Creditcoin CC3 testnet, used for external-chain attestation of transaction evidence</li>
          <li>a WalletConnect project, used to connect wallets from the browser</li>
          <li>a block explorer, used for view links to transaction and payout details</li>
        </ul>
        <p>These services may process data as part of providing their normal functions. You should review their own privacy practices if you use them directly.</p>

        <h2>6. Data retention</h2>
        <p>The current prototype retains information only as needed to operate the service.</p>
        <p>The application database retains wallet relationships until they are removed or the database is deleted.</p>
        <p>The claims log and other server-side logs are retained according to the server operator's local setup.</p>
        <p>If you need a specific retention period or deletion process, that should be confirmed with the project contact before relying on it.</p>

        <h2>7. Security</h2>
        <p>AncaSure takes reasonable steps to protect information used by the service.</p>
        <p>This includes limiting what is stored off-chain and keeping coverage and claim state on chain where it can be read directly from the contract.</p>
        <p>Security measures may not prevent every breach, loss, or misuse. Do not treat any system as perfectly secure.</p>

        <h2>8. User rights</h2>
        <p>Your rights depend on where you are located and on applicable law.</p>
        <p>Where applicable, you may have the right to ask what information is held about you, request correction, or request deletion.</p>
        <p>Because the current prototype is small and may run in different setups, not every right can be guaranteed in every deployment. Requests should be sent to the project contact.</p>
        <p><a href="mailto:trippleyay.aj@gmail.com" style={{ color: "var(--blue)", textDecoration: "underline" }}>Email</a></p>

        <h2>9. Children's privacy</h2>
        <p>AncaSure is not intended for children.</p>
        <p>If you are under the age required by your local law to use blockchain services or enter into contracts, you should not use AncaSure without appropriate permission.</p>
        <p>If AncaSure learns that it has collected information from a child in a way that violates applicable law, it should be reported to the project contact so the information can be reviewed.</p>

        <h2>10. Changes</h2>
        <p>This privacy notice may change over time.</p>
        <p>If the service changes what it collects or how it uses information, this notice will be updated.</p>
        <p>Continued use of the service after a change means you accept the updated notice.</p>

        <h2>11. Contact</h2>
        <p>If you have questions about privacy, contact:</p>
        <p><a href="mailto:trippleyay.aj@gmail.com" style={{ color: "var(--blue)", textDecoration: "underline" }}>Email</a></p>
        <p>The current prototype does not sell your information and does not use it for advertising.</p>
      </div>
    </div>
  );
}
