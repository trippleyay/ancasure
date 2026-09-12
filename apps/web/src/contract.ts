// Structured (parsed) ABI — viem's writeContract chokes on human-readable
// strings for payable array-arg functions ("cannot use 'in' operator…").
export const ANCA_SURE_ABI = [
  {
    type: "function",
    name: "registerProtectionFor",
    stateMutability: "payable",
    inputs: [{ name: "wallets", type: "address[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeProtection",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "quotePayout",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "verifiedLossRaw", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isCovered",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "policies",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "capRaw", type: "uint96" },
      { name: "expiresAt", type: "uint64" },
      { name: "payer", type: "address" },
    ],
  },
  {
    type: "function",
    name: "PREMIUM_PER_WALLET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// Set after deploy / read from API /health claimsContractAddress
export let claimsContractAddress = "0xE3C87A15aa5907E13f8C3b693Ac8d13CA01F41C2"; // sepolia v2

export function setClaimsAddress(a: string) {
  claimsContractAddress = a;
}
