import { describe, it, expect } from "vitest";
import { detectSandwichRun } from "@ancsure/detector";
import { normalizeTransaction } from "@ancsure/ethereum";
import {
  ATTACKER,
  OTHER_USER,
  PAIR,
  PAIR2,
  swapLog,
  makeReceipt,
  VICTIM,
} from "./fixtures.js";

/**
 * Build a synthetic block as a map index -> (from, logs, status), then test
 * detectSandwichRun against it. This models full-block evidence directly.
 */
function makeBlock(
  txs: Record<number, { from: string; logs: ReturnType<typeof swapLog>[]; status?: number }>,
) {
  const getTx = async (i: number) => {
    const t = txs[i];
    if (!t) return null;
    return normalizeTransaction(
      {
        hash: "0x" + i.toString(16).padStart(64, "0"),
        blockNumber: 100,
        transactionIndex: i,
        from: t.from,
        to: PAIR,
        value: 0n,
        input: "0x",
      },
      { status: t.status ?? 1, transactionHash: "r" + i, logs: t.logs } as never,
      null,
    );
  };
  return { getTx };
}

describe("run-based sandwich detector", () => {
  it("1. classifies a valid single-victim sandwich", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B", { to: VICTIM })] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("SANDWICH");
    expect(r.victims).toHaveLength(1);
    expect(r.rules.every((x) => x.passed)).toBe(true);
  });

  it("2. normal swap with unrelated neighbors is NOT_SANDWICH", async () => {
    const { getTx } = makeBlock({
      3: { from: OTHER_USER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("3. two unrelated swaps around victim", async () => {
    const { getTx } = makeBlock({
      3: { from: OTHER_USER, logs: [swapLog(PAIR, "B_TO_A")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: OTHER_USER, logs: [] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("4. same pool but different front/back senders", async () => {
    const { getTx } = makeBlock({
      3: { from: OTHER_USER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("5. same attacker but different pools (front/back on pool2, victim on pool1)", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR2, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR2, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
    // The mirror check fails because the victim's pool isn't attacked
  });

  it("6. failed victim transaction is NOT_SANDWICH", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")], status: 0 },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
    expect(r.rules.find((x) => x.rule === "victimExecuted")!.passed).toBe(false);
  });

  it("7. multi-hop victim sandwiched on one hop -> SANDWICH; non-sandwiched multi-hop -> NOT_SANDWICH", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR2, "A_TO_B")] },
      4: {
        from: VICTIM,
        logs: [swapLog(PAIR, "A_TO_B"), { ...swapLog(PAIR2, "A_TO_B"), logIndex: 2 }],
      },
      5: { from: ATTACKER, logs: [swapLog(PAIR2, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("SANDWICH");
    expect(r.pair).toBe(PAIR2);

    const { getTx: getTx2 } = makeBlock({
      3: { from: OTHER_USER, logs: [swapLog(PAIR, "B_TO_A")] },
      4: {
        from: VICTIM,
        logs: [swapLog(PAIR, "A_TO_B"), { ...swapLog(PAIR2, "A_TO_B"), logIndex: 2 }],
      },
      5: { from: OTHER_USER, logs: [swapLog(PAIR, "A_TO_B")] },
    });
    const r2 = await detectSandwichRun(100, 4, getTx2);
    expect(r2.classification).toBe("NOT_SANDWICH");
  });

  it("8. transaction with no Swap events anywhere in the run", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [] },
      4: { from: VICTIM, logs: [] },
      5: { from: ATTACKER, logs: [] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("9. multiple Swap events across victims and hops still resolves", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: {
        from: VICTIM,
        logs: [{ ...swapLog(PAIR2, "B_TO_A"), logIndex: 0 }, { ...swapLog(PAIR, "A_TO_B"), logIndex: 1 }],
      },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("SANDWICH");
    expect(r.pair).toBe(PAIR);
  });

  it("10. false-positive guard: directions don't form front=victim, back=opposite", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("10b. mirrored sandwich (front-run B_TO_A) is correctly detected", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "B_TO_A")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("SANDWICH");
  });

  it("11. MULTI-VICTIM same pool: front, v1, v2, back all on one pair", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: OTHER_USER, logs: [swapLog(PAIR, "A_TO_B")] },
      6: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("SANDWICH");
    expect(r.victims.map((v) => v.transactionIndex)).toEqual([4, 5]);
    expect(r.victims[0].hash).not.toBe(r.victims[1].hash);
  });

  it("12. MULTI-VICTIM MULTI-POOL: two victims on DIFFERENT pools between one attacker's mirrored front/back", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B"), swapLog(PAIR2, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },          // victim 1 on pool1
      5: { from: OTHER_USER, logs: [swapLog(PAIR2, "A_TO_B")] },     // victim 2 on pool2
      6: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A"), swapLog(PAIR2, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("SANDWICH");
    expect(r.victims.map((v) => v.transactionIndex)).toEqual([4, 5]);
    expect(r.pairs!.sort()).toEqual([PAIR, PAIR2].sort());
    // Each victim is attributed only to the pool they actually swapped
    expect(r.victims[0].pairsSwapped).toEqual([{ pair: PAIR, direction: "A_TO_B" }]);
    expect(r.victims[1].pairsSwapped).toEqual([{ pair: PAIR2, direction: "A_TO_B" }]);
  });

  it("13. multi-pool guard: attacker mirrors both legs but NO victim touches either pool -> NOT_SANDWICH", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B"), swapLog(PAIR2, "A_TO_B")] },
      4: { from: VICTIM, logs: [] }, // unrelated tx (e.g. plain transfer)
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A"), swapLog(PAIR2, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
    const ve = r.rules.find((x) => x.rule === "victimExecuted");
    if (ve) expect(ve.passed).toBe(false);
    expect(r.victims).toHaveLength(0);
  });

  it("14. multi-pool partial-mirror guard: back-run closes only one of two front legs -> NOT_SANDWICH", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B"), swapLog(PAIR2, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] }, // missing PAIR2 leg
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("15. proximity-only guard: adjacent swaps by same sender but no mirror structure -> NOT_SANDWICH", async () => {
    // Same sender, adjacent, same pool — but both neighbors same direction:
    // no round-trip, so no sandwich.
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("16. gap guard: non-contiguous slice cannot be stitched into a run", async () => {
    const { getTx } = makeBlock({
      2: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
      // index 3 missing -> gap
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    // Front at idx2 does not touch idx3 so the only valid split uses... nothing
    // before except a boundary-less scan; result must be NOT_SANDWICH.
    expect(r.classification).toBe("NOT_SANDWICH");
  });

  it("17. mixed executed/reverted victims: reverted one excluded, executed kept", async () => {
    const { getTx } = makeBlock({
      3: { from: ATTACKER, logs: [swapLog(PAIR, "A_TO_B")] },
      4: { from: VICTIM, logs: [swapLog(PAIR, "A_TO_B")] },
      5: { from: OTHER_USER, logs: [swapLog(PAIR, "A_TO_B")], status: 0 }, // reverted victim
      6: { from: OTHER_USER, logs: [swapLog(PAIR, "A_TO_B")] },
      7: { from: ATTACKER, logs: [swapLog(PAIR, "B_TO_A")] },
    });
    const r = await detectSandwichRun(100, 4, getTx);
    expect(r.classification).toBe("SANDWICH");
    expect(r.victims.map((v) => v.transactionIndex)).toEqual([4, 6]);
  });
});
