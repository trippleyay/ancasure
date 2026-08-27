import type {
  Classification,
  DetectionResult,
  RuleResult,
  SwapDirection,
  TransactionEvidence,
  VictimRecord,
} from "@ancsure/shared";

/**
 * Deterministic sandwich detection rules — run-based (multi-victim, multi-pool).
 *
 * A "run" is a contiguous slice of one block:
 *   [front-run] [victim*1..N] [back-run]
 *
 * Structural requirements (NOT mere proximity):
 *   R1. front and back are adjacent to the victim run on both ends (OBSERVED).
 *   R2. front.from === back.from (same originating address) (OBSERVED).
 *   R3. Every pool the attacker's front-run swapped is ALSO swapped by the
 *       back-run, in the OPPOSITE direction, with no extra pools in either.
 *       This is the "coordinated trade sequence" requirement (INFERRED from
 *       OBSERVED Swap events). For a multi-pool front-run (e.g. an arbitrage
 *       route), the back-run must mirror every leg reversed. This makes
 *       round-trip profit-seeking explicit instead of assuming it.
 *   R4. At least one victim tx swapped on at least one of those pools
 *       (INFERRED); a failed victim does not invalidate the attack but a run
 *       where NO victim executed on any attacked pool is not classified.
 *   R5. Each victim reported must have actually executed (status === 1) on at
 *       least one attacked pool; victims that reverted are excluded from the
 *       victim list but do not break adjacency of the others.
 *
 * What we deliberately still require: the attacker's own two transactions
 * demonstrate the coordinated position open/close across the SAME set of
 * pools. We do NOT classify arbitrary adjacent swaps as sandwiches.
 */

const known = (d: SwapDirection | null | undefined): d is "A_TO_B" | "B_TO_A" =>
  d === "A_TO_B" || d === "B_TO_A";

function opposite(d: "A_TO_B" | "B_TO_A"): "A_TO_B" | "B_TO_A" {
  return d === "A_TO_B" ? "B_TO_A" : "A_TO_B";
}

/** Per-pair direction map for a tx, restricted to definite directions. */
function dirMap(tx: TransactionEvidence): Map<string, "A_TO_B" | "B_TO_A"> {
  const m = new Map<string, "A_TO_B" | "B_TO_A">();
  for (const [pair, dir] of tx.directions) {
    if (known(dir)) m.set(pair, dir);
  }
  return m;
}

export interface RunWindow {
  blockNumber: number;
  /** indices of the contiguous candidate run inside the block */
  startIndex: number;
  endIndex: number;
}

/**
 * Detect a sandwich run given the full ordered transaction list of a block and
 * the index of the primary suspected victim. Neighbors beyond +/-1 are fetched
 * lazily by the caller-supplied `getTx(index)` so RPC cost stays proportional
 * to the actual run length.
 */
export async function detectSandwichRun(
  blockNumber: number,
  suspectIndex: number,
  getTx: (index: number) => Promise<TransactionEvidence | null>,
): Promise<DetectionResult> {
  const rules: RuleResult[] = [];
  const suspect = await getTx(suspectIndex);
  if (!suspect || suspect.blockNumber !== blockNumber) {
    throw new Error(`No evidence for suspect index ${suspectIndex} in block ${blockNumber}`);
  }

  // --- Expand left: collect contiguous same-block txs while they are NOT
  // attacker-closing swaps. The front-run boundary is found by scanning left
  // until we hit a tx whose swap set could close what follows. Simplest robust
  // approach: walk left/right collecting candidates, then test all splits.

  // Collect up to MAX_RUN txs on each side (contiguous indices). No early
  // stopping: victims may themselves contain Swap events, so we take the whole
  // bounded window and let the split search find the true boundaries.
  const MAX_RUN = 6;
  const left: TransactionEvidence[] = [];
  for (let i = suspectIndex - 1; i >= Math.max(0, suspectIndex - MAX_RUN); i--) {
    const t = await getTx(i);
    if (!t) break;
    left.unshift(t);
  }
  const right: TransactionEvidence[] = [];
  for (let i = suspectIndex + 1; i <= suspectIndex + MAX_RUN; i++) {
    const t = await getTx(i);
    if (!t) break;
    right.push(t);
  }

  // Try every split: front = last of left-prefix, back = first of right-suffix,
  // victims = everything strictly between them (must include the suspect).
  let best: {
    front: TransactionEvidence;
    back: TransactionEvidence;
    victims: TransactionEvidence[];
    attacker: string;
    pairs: string[];
  } | null = null;

  for (let fi = 0; fi < left.length; fi++) {
    // victims between left[fi..end] are not allowed to include non-adjacent gaps;
    // front must be immediately followed by the victim run.
    const front = left[fi];
    if (!front) continue;

    for (let bi = 0; bi < right.length; bi++) {
      const back = right[bi];
      // victims = left after fi + suspect + right before bi
      const victims: TransactionEvidence[] = [
        ...left.slice(fi + 1),
        suspect,
        ...right.slice(0, bi),
      ];
      // Contiguity check (OBSERVED)
      let contiguous =
        back.transactionIndex === victims[victims.length - 1].transactionIndex + 1 &&
        front.transactionIndex === victims[0].transactionIndex - 1;
      if (!contiguous) continue;

      // R2: same originating address
      if (front.from !== back.from) continue;

      // R3: coordinated mirrored trade sequence over the same pool set
      const fDirs = dirMap(front);
      const bDirs = dirMap(back);
      if (fDirs.size === 0 || bDirs.size === 0) continue;
      if (fDirs.size !== bDirs.size) continue;
      let mirrored = true;
      const attackedPairs: string[] = [];
      for (const [pair, fd] of fDirs) {
        const bd = bDirs.get(pair);
        if (!bd || bd !== opposite(fd)) {
          mirrored = false;
          break;
        }
        attackedPairs.push(pair);
      }
      if (!mirrored) continue;

      // R4: at least one victim touched an attacked pool with matching direction
      const touching = victims.filter((v) => {
        const vd = dirMap(v);
        return attackedPairs.some((p) => vd.get(p) === fDirs.get(p));
      });
      if (touching.length === 0) continue;

      // Prefer the WIDEST valid split: keep the candidate with the most
      // executed victims on attacked pools (ties -> most victims, then widest).
      const executedCount = touching.filter((v) => v.status === 1).length;
      if (best) {
        const bestExecuted = best.victims.filter(
          (v) =>
            v.status === 1 &&
            best!.pairs.some((p) => dirMap(v).get(p) === dirMap(best!.front).get(p)),
        ).length;
        if (
          executedCount < bestExecuted ||
          (executedCount === bestExecuted && victims.length <= best.victims.length)
        ) {
          continue;
        }
      }
      best = { front, back, victims, attacker: front.from, pairs: attackedPairs };
    }
  }

  // --- Rules report ---------------------------------------------------------
  if (!best) {
    rules.push({
      rule: "sandwichPattern",
      passed: false,
      detail:
        "no contiguous [front-run][victims+][back-run] slice found where front/back share the originating address, mirror each other's exact pool set with opposite directions, and at least one executed victim swaps an attacked pool in the front-run direction",
      kind: "INFERRED",
    });
    return buildResult("NOT_SANDWICH", null, null, [], suspect.blockNumber, [], null, rules, null);
  }

  const { front, back, victims, attacker, pairs } = best;
  const fDirs = dirMap(front);

  rules.push({
    rule: "adjacentRun",
    passed: true,
    detail: `contiguous run: front idx ${front.transactionIndex}, victims idx ${victims
      .map((v) => v.transactionIndex)
      .join(",")}, back idx ${back.transactionIndex}, block ${blockNumber}`,
    kind: "OBSERVED",
  });

  rules.push({
    rule: "sameAttacker",
    passed: true,
    detail: `front-run and back-run share originating address ${attacker}. LIMITATION: tx.from is the fee payer; with private relays/contracts or router-permissioned flows the economic attacker may differ.`,
    kind: "INFERRED",
  });

  rules.push({
    rule: "coordinatedMirror",
    passed: true,
    detail: `attacker front-run swaps ${pairs
      .map((p) => `${p}:${fDirs.get(p)}`)
      .join(", ")} and back-run reverses every leg (${pairs.length} pool${pairs.length > 1 ? "s" : ""})`,
    kind: "INFERRED",
  });

  // R5: victim records — only executed victims on attacked pools
  const victimRecords: VictimRecord[] = [];
  const excluded: string[] = [];
  for (const v of victims) {
    const vd = dirMap(v);
    const legs = pairs
      .filter((p) => vd.get(p) === fDirs.get(p))
      .map((p) => ({ pair: p, direction: vd.get(p)! }));
    if (legs.length > 0 && v.status === 1) {
      victimRecords.push({
        hash: v.hash,
        transactionIndex: v.transactionIndex,
        from: v.from,
        status: v.status,
        pairsSwapped: legs,
      });
    } else {
      excluded.push(
        `${v.hash.slice(0, 12)}… (${
          v.status !== 1 ? "reverted" : "no attacked-pool swap"
        })`,
      );
    }
  }

  const classification: Classification =
    victimRecords.length > 0 ? "SANDWICH" : "NOT_SANDWICH";

  rules.push({
    rule: "victimExecuted",
    passed: victimRecords.length > 0,
    detail:
      `${victimRecords.length} victim tx(s) executed on attacked pool(s)` +
      (excluded.length ? `; excluded from victim list: ${excluded.join(", ")}` : ""),
    kind: "OBSERVED",
  });

  // Primary victim execution price from its Swap amounts on the first attacked pool
  let victimPrice: string | null = null;
  const primary = victimRecords[0];
  if (primary) {
    const vEv = victims.find((v) => v.hash === primary.hash)!;
    const p0 = primary.pairsSwapped[0].pair;
    const vSwap = vEv.swapEvents.find((s) => s.pairAddress === p0);
    if (vSwap) {
      if (vSwap.amount0In > 0n && vSwap.amount1Out > 0n) {
        victimPrice = `${vSwap.amount1Out}/${vSwap.amount0In} (token1 out per token0 in, raw units)`;
      } else if (vSwap.amount1In > 0n && vSwap.amount0Out > 0n) {
        victimPrice = `${vSwap.amount0Out}/${vSwap.amount1In} (token0 out per token1 in, raw units)`;
      }
    }
  }

  rules.push({
    rule: "sandwichPattern",
    passed: true,
    detail:
      "composite: contiguous run AND sameAttacker AND coordinatedMirror AND >=1 executed victim on an attacked pool",
    kind: "INFERRED",
  });

  return buildResult(
    classification,
    front,
    back,
    victimRecords,
    blockNumber,
    pairs,
    attacker,
    rules,
    victimPrice,
  );
}

function buildResult(
  classification: Classification,
  front: TransactionEvidence | null,
  back: TransactionEvidence | null,
  victims: VictimRecord[],
  blockNumber: number,
  pairs: string[],
  attacker: string | null,
  rules: RuleResult[],
  victimPrice: string | null,
): DetectionResult {
  const failed = rules.filter((r) => !r.passed);
  const explanation = [
    `Classification: ${classification}`,
    failed.length === 0
      ? "All deterministic rules passed."
      : `Failed rules: ${failed.map((f) => `${f.rule} (${f.detail})`).join("; ")}`,
    victimPrice ? `Victim effective execution price: ${victimPrice}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    classification,
    victimTx: victims[0]?.hash ?? "n/a",
    frontRunTx: front?.hash ?? null,
    backRunTx: back?.hash ?? null,
    victims,
    blockNumber,
    pairs: pairs.length ? pairs : null,
    pair: pairs[0] ?? null,
    attacker,
    victimExecutedPrice: victimPrice,
    rules,
    explanation,
  };
}
