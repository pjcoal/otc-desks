import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { DexScreenerApi } from "./dexscreener";

const A = "9d24jNVbvHQH3pCB1ZzxRjpFuVV4j1MMJDU3SPxQpump";
const B = "2rXTptX8axpo1c8KJ4WPL2VusxyFGGckUZ9UErs7QPvp";
const WSOL = "So11111111111111111111111111111111111111112";
const pair = (base: string, addr: string, vol: number, extra: object = {}) => ({
  chainId: "solana", dexId: "pumpswap", pairAddress: addr, baseToken: { address: base }, quoteToken: { address: WSOL },
  volume: { h24: vol }, liquidity: { usd: 1000.5, quote: 4.5 }, txns: { h24: { buys: 100, sells: 40 } }, priceChange: { h24: -12.5 }, marketCap: 40_000, ...extra,
});

afterEach(() => vi.unstubAllGlobals());
const stub = (body: unknown, status = 200) => {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("DexScreener adapter (untrusted input)", () => {
  it("sums 24h volume over a coin's pairs, in exact cents, ignoring malformed and foreign pairs", async () => {
    stub([
      pair(A, "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", 100_000.1),
      pair(A, "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", 50_000.2),
      pair(A, "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", 50_000.2), // duplicate pair
      pair(A, "not-an-address", 1e9),
      pair(A, "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ", -5),
      pair(A, "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", 1, { chainId: "ethereum" }),
      pair("So11111111111111111111111111111111111111112", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", 999), // coin is the quote side
    ]);
    const v = await new DexScreenerApi("https://example.test").tokenVolumes([A, B]);
    expect(v.get(A)).toEqual({ volume24hUsd: "150000.30", liquidityUsd: "2001.00", liquiditySolLamports: 9_000_000_000n, liquidityMcapBps: 500, buys24h: 200, sells24h: 80, priceChange24hBps: -1250, pairs: 2 });
    expect(v.get(B)).toEqual({ volume24hUsd: "0.00", liquidityUsd: "0.00", liquiditySolLamports: 0n, liquidityMcapBps: null, buys24h: 0, sells24h: 0, priceChange24hBps: null, pairs: 0 });
  });
  it("batches 30 addresses per request", async () => {
    const f = stub([]);
    const mints = Array.from({ length: 61 }, () => Keypair.generate().publicKey.toBase58());
    await new DexScreenerApi("https://example.test").tokenVolumes(mints);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("fails loudly when every request fails or the shape is wrong", async () => {
    stub({ error: "nope" }, 429);
    await expect(new DexScreenerApi("https://example.test").tokenVolumes([A])).rejects.toThrow(/429/);
    stub({ not: "an array" });
    await expect(new DexScreenerApi("https://example.test").tokenVolumes([A])).rejects.toThrow(/unexpected shape/);
  });
});
