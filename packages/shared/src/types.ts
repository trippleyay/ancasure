// Normalized evidence models. Everything here is either:
//  - OBSERVED: cryptographically observable from Ethereum (tx, receipt, logs)
//  - INFERRED: derived by this detector from observed data
// Each field is annotated where ambiguity exists.

export type SwapDirection = "A_TO_B" | "B_TO_A" | "UNKNOWN";

/** A decoded Uniswap V2 Pair.Swap(address,uint256,uint256,uint256,uint256,address) event. */
export interface DecodedSwapEvent {
  /** OBSERVED: log address (the pair contract that emitted it) */
  pairAddress: string;
  /** OBSERVED: sender (msg.sender to the pair, usually the router) */
  sender: string;
  /** OBSERVED: recipient of the output tokens */
  to: string;
  /** OBSERVED: amount0In / amount1In / amount0Out / amount1Out */
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  logIndex: number;
}

/** A decoded ERC-20 Transfer(address,address,uint256) event. */
export interface DecodedTransferEvent {
  tokenAddress: string;
  from: string;
  to: string;
  value: bigint;
  logIndex: number;
}

/** Token metadata. symbol/decimals are INFERRED via on-chain calls; may be missing. */
export interface TokenMetadata {
  address: string;
  symbol?: string;
  decimals?: number;
}

/** Uniswap V2 pair metadata. token0/token1 are OBSERVED from the pair contract. */
export interface PairMetadata {
  pairAddress: string;
  token0: string;
  token1: string;
  token0Meta?: TokenMetadata;
  token1Meta?: TokenMetadata;
}

/** All evidence gathered for a single transaction. */
export interface TransactionEvidence {
  /** OBSERVED */
  hash: string;
  blockNumber: number;
  transactionIndex: number;
  from: string;
  to: string | null;
  value: bigint;
  input: string;
  gasUsed?: bigint;
  effectiveGasPriceGwei?: string;
  /** OBSERVED: receipt status — 1 = success, 0 = failed/reverted */
  status: number;
  logs: DecodedSwapEvent[] & unknown[];
  /** OBSERVED+DECODED */
  swapEvents: DecodedSwapEvent[];
  transferEvents: DecodedTransferEvent[];
  /**
   * INFERRED: pairs this tx interacted with, derived from Swap-event emitting
   * contracts AND (for txs with no Swap event) from calldata addresses.
   * See docs/rules.md for derivation details.
   */
  pairs: Map<string, PairMetadata>;
  /**
   * INFERRED: swap direction per pair, computed from Swap amounts + pair token order.
   */
  directions: Map<string, SwapDirection>;
}

export type Classification = "SANDWICH" | "NOT_SANDWICH";

export interface RuleResult {
  rule: string;
  passed: boolean;
  detail: string;
  /** whether this is observable fact or inference */
  kind: "OBSERVED" | "INFERRED";
}

/**
 * One victim inside a detected sandwich run.
 * `pairsSwapped` lists the V2 pairs this victim tx swapped on and the
 * direction of each — a multi-hop victim can list several.
 */
export interface VictimRecord {
  hash: string;
  transactionIndex: number;
  from: string;
  status: number;
  pairsSwapped: { pair: string; direction: SwapDirection }[];
}

export interface DetectionResult {
  classification: Classification;
  /** Primary (first) victim in the run. Retained for backward compatibility. */
  victimTx: string;
  frontRunTx: string | null;
  backRunTx: string | null;
  /** All victims in the run, ordered by transaction index. Length >= 1 when SANDWICH. */
  victims: VictimRecord[];
  blockNumber: number;
  /** All pools the attacker's front-run traded on. */
  pairs: string[] | null;
  /** Primary pool — retained for backward compatibility (first of `pairs`). */
  pair: string | null;
  attacker: string | null;
  victimExecutedPrice?: string | null;
  rules: RuleResult[];
  explanation: string;
}
