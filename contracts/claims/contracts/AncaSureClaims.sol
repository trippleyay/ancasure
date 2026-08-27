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

    // ---------- policy ----------
    struct Policy {
        uint96 capRaw;
        bool active;
    }
    mapping(address => Policy) public policies;
    event PolicyRegistered(address indexed user, uint256 capRaw);
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

    /** @notice Judge/user registers a wallet with its per-claim payout cap. */
    function registerProtection(uint256 capRaw) external {
        if (capRaw == 0) revert CapTooSmall();
        if (capRaw > maxCapRaw) revert CapTooLarge();
        policies[msg.sender] = Policy({ capRaw: uint96(capRaw), active: true });
        emit PolicyRegistered(msg.sender, capRaw);
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
        if (!p.active) revert PolicyInactive();

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
        if (!p.active) return 0;
        return _min((verifiedLossRaw * RATIO_NUMERATOR) / RATIO_DENOMINATOR, p.capRaw);
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
