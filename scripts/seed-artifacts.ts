/**
 * Seed data/demo/artifacts.json from the previously deployed (and
 * golden-validated) MEVTEST token + pair. No chain calls, no gas.
 *   npx tsx scripts/seed-artifacts.ts
 */
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { saveArtifacts, deriveChildKey, ROOT } from "../demo/lib";

// minimal .env read (demo/lib's loader is module-private)
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

let pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("PRIVATE_KEY not set in .env");
if (!pk.startsWith("0x")) pk = "0x" + pk;
const attacker = new ethers.Wallet(pk).address;

saveArtifacts({
  mevTestToken: "0x0BFEEaeA054068F6befcF03d9C09D416788c49D1",
  pair: "0x0fC13e7D6111f5128579A83028d98505913192c5",
  source: "previously deployed MEVTEST + WETH/MEVTEST pair (golden-validated)",
  attacker,
  victim: new ethers.Wallet(deriveChildKey("mev-shield-victim")).address,
});
console.log("attacker:", attacker);
console.log("victim:  ", new ethers.Wallet(deriveChildKey("mev-shield-victim")).address);
