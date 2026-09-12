export const ANCA_SURE_ABI = [
  "function registerProtectionFor(address[] wallets) payable",
  "function revokeProtection()",
  "function submitVerifiedClaim(address claimant,uint256 verifiedLossRaw,bytes32 victimTxHash) returns (uint256)",
  "function payClaim(uint256 id)",
  "function quotePayout(address user,uint256 verifiedLossRaw) view returns (uint256)",
  "function isCovered(address user) view returns (bool)",
  "function policies(address) view returns (uint96 capRaw,uint64 expiresAt,address payer)",
  "function PREMIUM_PER_WALLET() view returns (uint256)",
  "function RATIO_NUMERATOR() view returns (uint256)",
  "function RATIO_DENOMINATOR() view returns (uint256)",
] as const;

// Set after deploy / read from API /health claimsContractAddress
export let claimsContractAddress = "0xE3C87A15aa5907E13f8C3b693Ac8d13CA01F41C2"; // sepolia v2

export function setClaimsAddress(a: string) {
  claimsContractAddress = a;
}
