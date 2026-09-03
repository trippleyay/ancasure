// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AncaSureClaims
 * @notice Minimal MVP claim/insurance contract for AncaSure.
 *
 * Claim rule:  payout = min(verifiedLoss * 70 / 100, policy.cap)
 *
 * SECURITY MODEL
 * - The contract NEVER trusts a frontend-provided loss value.
 * - `submitVerifiedClaim` is callable only by `authorizer` — the backend EOA
 *   whose value is derived from the Creditcoin/Attestcoin proof pipeline
 *   (see packages/creditcoin) and packages/simulator's counterfactual engine.
 * - Caps are enforced in-contract; single-use payout with checks-effects-
 *   interactions ordering.
 */
contract AncaSureClaims {
    // ---------- errors ----------
    error NotOwner();
    error NotAuthorizer();
    error ZeroAddress();
    error CapTooLarge();
    error CapTooSmall();
    error PolicyInactive();
    error WrongState();
    error PayoutFailed();

    // ---------- claim economics ----------
    uint256 public constant RATIO_NUMERATOR = 70;
    uint256 public constant RATIO_DENOMINATOR = 100;
    uint256 public immutable maxCapRaw;

    // ---------- protection economics ----------
    /// @notice Fixed testnet premium per wallet per coverage period (no USD oracle).
    uint256 public constant PREMIUM_PER_WALLET = 0.001 ether;
    /// @notice Coverage period per premium payment.
    uint256 public constant COVERAGE_SECONDS = 30 days;

    // ---------- policy ----------
    struct Policy {
        uint96 capRaw;      // per-claim payout cap (defaults to maxCapRaw)
        uint64 expiresAt;   // coverage end timestamp
        address payer;      // wallet that paid the premium (may differ from owner)
    }
    mapping(address => Policy) public policies;
    event PolicyRegistered(address indexed wallet, address indexed payer, uint256 capRaw, uint256 expiresAt);
    event PolicyRevoked(address indexed user);

    // ---------- claims ----------
    enum ClaimState { None, Eligible, Paid }

    struct Claim {
        address claimant;
        uint256 verifiedLossRaw;
        uint256 payoutRaw;
        ClaimState state;
        bytes32 victimTxHash;
    }

    uint256 public nextClaimId = 1;
    mapping(uint256 => Claim) public claims;

    event ClaimAuthorized(
        uint256 indexed id,
        address indexed claimant,
        uint256 verifiedLossRaw,
        uint256 payoutRaw,
        bytes32 victimTxHash
    );
    event ClaimPaid(uint256 indexed id, address indexed claimant, uint256 amount);

    // ---------- roles ----------
    address public owner;
    address public authorizer;
    event AuthorizerChanged(address indexed previous, address indexed current);
    event OwnershipTransferred(address indexed previous, address indexed current);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorizer() {
        if (msg.sender != authorizer) revert NotAuthorizer();
        _;
    }

    /**
     * @param authorizer_ Backend signer allowed to record verified losses.
     * @param maxCapRaw_ Global upper bound for any individual policy cap.
     */
    constructor(address authorizer_, uint256 maxCapRaw_) {
        if (authorizer_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        authorizer = authorizer_;
        maxCapRaw = maxCapRaw_;
    }

    receive() external payable {} // fund the payout pool

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAuthorizer(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        emit AuthorizerChanged(authorizer, a);
        authorizer = a;
    }

    /**
     * @notice Protect one or more wallets for COVERAGE_SECONDS. The connected
     *         wallet (msg.sender) is the PAYER; protected wallets may be any
     *         addresses (typically wallets the payer also controls).
     * @dev Premium must exactly match wallets.length × PREMIUM_PER_WALLET.
     *      Coverage cap defaults to maxCapRaw. Premiums fund the payout pool.
     */
    function registerProtectionFor(address[] calldata wallets) external payable {
        uint256 n = wallets.length;
        if (n == 0) revert CapTooSmall();
        if (msg.value != n * PREMIUM_PER_WALLET) revert WrongState();
        for (uint256 i = 0; i < n; i++) {
            address w = wallets[i];
            if (w == address(0)) revert ZeroAddress();
            uint64 exp = uint64(block.timestamp + COVERAGE_SECONDS);
            policies[w] = Policy({ capRaw: uint96(maxCapRaw), expiresAt: exp, payer: msg.sender });
            emit PolicyRegistered(w, msg.sender, maxCapRaw, exp);
        }
    }

    function revokeProtection() external {
        delete policies[msg.sender];
        emit PolicyRevoked(msg.sender);
    }

    /**
     * @notice Records a verified loss computed off-chain by the proof pipeline.
     * @dev Only callable by the backend authorizer. The verifiedLossRaw argument
     *      is the output of the deterministic counterfactual simulator over
     *      Attestcoin-verified transaction evidence — never user input.
     */
    function submitVerifiedClaim(
        address claimant,
        uint256 verifiedLossRaw,
        bytes32 victimTxHash
    ) external onlyAuthorizer returns (uint256 id) {
        Policy memory p = policies[claimant];
        if (p.expiresAt <= block.timestamp) revert PolicyInactive();

        uint256 payout = (verifiedLossRaw * RATIO_NUMERATOR) / RATIO_DENOMINATOR;
        if (payout > p.capRaw) payout = p.capRaw;

        id = nextClaimId++;
        claims[id] = Claim({
            claimant: claimant,
            verifiedLossRaw: verifiedLossRaw,
            payoutRaw: payout,
            state: ClaimState.Eligible,
            victimTxHash: victimTxHash
        });
        emit ClaimAuthorized(id, claimant, verifiedLossRaw, payout, victimTxHash);
    }

    /** @notice Pays an eligible claim (single-use). Callable by anyone. */
    function payClaim(uint256 id) external {
        Claim storage c = claims[id];
        if (c.state != ClaimState.Eligible) revert WrongState();
        c.state = ClaimState.Paid; // effects before interaction

        address claimant = c.claimant;
        uint256 amount = c.payoutRaw;
        (bool ok, ) = payable(claimant).call{value: amount}("");
        if (!ok) revert PayoutFailed();
        emit ClaimPaid(id, claimant, amount);
    }

    /// @dev Off-chain quote helper mirroring the on-chain computation.
    function quotePayout(address user, uint256 verifiedLossRaw) external view returns (uint256) {
        Policy memory p = policies[user];
        if (p.expiresAt <= block.timestamp) return 0;
        return _min((verifiedLossRaw * RATIO_NUMERATOR) / RATIO_DENOMINATOR, p.capRaw);
    }

    /// @notice Convenience view for frontends: is this wallet covered right now?
    function isCovered(address user) external view returns (bool) {
        return policies[user].expiresAt > block.timestamp;
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
