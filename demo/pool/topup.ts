/**
 * Top up an address from the master (attacker) wallet.
 *   npx tsx demo/pool/topup.ts <0xJudgeAddress> [amountEth]
 * Used to seed the judge/victim wallet in the controlled demo.
 */
import { ethers } from "ethers";
import { log, getProvider, getMasterWallet, retry } from "../lib";

export async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
    console.error("Usage: npx tsx demo/pool/topup.ts 0x<address> [amountEth]");
    process.exit(1);
  }
  const amount = ethers.parseEther(process.argv[3] ?? "0.005");
  const provider = getProvider();
  const master = getMasterWallet(provider);

  const before = await retry("bal", () => provider.getBalance(to));
  log(`${to} balance before: ${ethers.formatEther(before)} ETH`);

  const tx = await retry("topup:broadcast", () =>
    master.sendTransaction({
      to,
      value: amount,
      maxFeePerGas: ethers.parseUnits("40", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
      gasLimit: 21_000,
    }),
  );
  const rc = await retry("topup:wait", async () => {
    const r = await tx.wait();
    if (!r || r.status !== 1) throw new Error("topup status!=1");
    return r;
  });
  log(`topup: block ${rc.blockNumber}, tx ${rc.hash}`);
  log(`${to} balance after: ${ethers.formatEther(await provider.getBalance(to))} ETH`);
}

if (process.argv[1] && process.argv[1].endsWith("topup.ts")) {
  main().catch((e) => {
    console.error("TOPUP FAILED:", e.message ?? e);
    process.exit(1);
  });
}
