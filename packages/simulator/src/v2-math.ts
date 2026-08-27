/**
 * Official Uniswap V2 pair mechanics (v2-core UniswapV2Pair.sol), integer-exact.
 *
 * getAmountOut — verbatim formula from v2-core:
 *   amountInWithFee = amountIn * 997
 *   numerator       = amountInWithFee * reserveOut
 *   denominator     = reserveIn * 1000 + amountInWithFee
 *   amountOut       = numerator / denominator   (integer division, floor)
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  if (amountIn <= 0n) throw new Error("INSUFFICIENT_INPUT_AMOUNT");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("INSUFFICIENT_LIQUIDITY");
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * Apply one swap to reserves exactly as UniswapV2Pair._update does for a Swap
 * call: balance0 = reserve0 + amount0In - amount0Out (same for token1).
 */
export function applySwap(
  reserves: { reserve0: bigint; reserve1: bigint },
  amount0In: bigint,
  amount1In: bigint,
  amount0Out: bigint,
  amount1Out: bigint,
): { reserve0: bigint; reserve1: bigint } {
  return {
    reserve0: reserves.reserve0 + amount0In - amount0Out,
    reserve1: reserves.reserve1 + amount1In - amount1Out,
  };
}

/** Reverse of applySwap: recover reserves BEFORE a known swap from reserves AFTER it. */
export function reverseSwap(
  reservesAfter: { reserve0: bigint; reserve1: bigint },
  amount0In: bigint,
  amount1In: bigint,
  amount0Out: bigint,
  amount1Out: bigint,
): { reserve0: bigint; reserve1: bigint } {
  return {
    reserve0: reservesAfter.reserve0 - amount0In + amount0Out,
    reserve1: reservesAfter.reserve1 - amount1In + amount1Out,
  };
}
