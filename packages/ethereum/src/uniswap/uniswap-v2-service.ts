import { Contract, Provider } from "ethers";
import type { PairMetadata } from "@ancsure/shared";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

/** Official Uniswap V2 factory mainnet address (OBSERVED constant). */
export const UNISWAP_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) view returns (address pair)"];
const PAIR_ABI = ["function token0() view returns (address)", "function token1() view returns (address)"];

export class UniswapV2Service {
  constructor(private provider: Provider) {}

  /** OBSERVED: read token0()/token1() from a pair contract. */
  async getPairMetadata(pairAddress: string): Promise<PairMetadata | null> {
    try {
      const pair = new Contract(pairAddress, PAIR_ABI, this.provider);
      const [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);
      return { pairAddress, token0, token1 };
    } catch {
      return null;
    }
  }

  /** INFERRED helper: canonical pair for two tokens via official V2 factory. */
  async getPairForTokens(tokenA: string, tokenB: string): Promise<string | null> {
    try {
      const f = new Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, this.provider);
      const p: string = await f.getPair(tokenA, tokenB);
      return p === ethers_zeroAddress() ? null : p;
    } catch {
      return null;
    }
  }

  /** Best-effort token metadata; may fail on non-standard tokens. */
  async getTokenMetadata(address: string): Promise<{ symbol?: string; decimals?: number }> {
    try {
      const c = new Contract(address, ERC20_ABI, this.provider);
      const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
      return { symbol, decimals: Number(decimals) };
    } catch {
      return {};
    }
  }
}

function ethers_zeroAddress(): string {
  return "0x0000000000000000000000000000000000000000";
}
