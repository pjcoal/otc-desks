/**
 * OPTIONAL listing-stats source: DexScreener's public API (`/tokens/v1/{chain}/{addresses}`, up to 30
 * addresses per request, 300 requests/min). Used only to decide which coins are listed (volume and
 * chart-quality signals) and to show 24h volume. Prices on token pages, quotes, trades and settlement
 * always come from the chain. Responses are untrusted: validated, size-limited, malformed pairs dropped.
 */
import { z } from "zod";

const BATCH = 30;
const WSOL = "So11111111111111111111111111111111111111112";
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const usd = z.number().nonnegative().max(1e15);
const count = z.number().int().nonnegative().max(1e9);

const pairSchema = z.object({
  chainId: z.literal("solana"),
  dexId: z.string().max(64),
  pairAddress: base58,
  baseToken: z.object({ address: base58 }),
  quoteToken: z.object({ address: base58 }).nullish(),
  volume: z.object({ h24: usd.nullish() }).nullish(),
  liquidity: z.object({ usd: usd.nullish(), quote: usd.nullish() }).nullish(),
  txns: z.object({ h24: z.object({ buys: count.nullish(), sells: count.nullish() }).nullish() }).nullish(),
  priceChange: z.object({ h24: z.number().min(-100).max(1e9).nullish() }).nullish(),
  marketCap: usd.nullish(),
  fdv: usd.nullish(),
});

export interface TokenVolume {
  /** Sum of 24h volume across every pair where the coin is the base token, in USD (2-dp decimal string). */
  volume24hUsd: string;
  liquidityUsd: string;
  /** SOL held on the SOL side of the coin's SOL-quoted pools, in lamports. */
  liquiditySolLamports: bigint;
  /** Total liquidity as a share of market cap, in basis points. Null when no market cap is reported. */
  liquidityMcapBps: number | null;
  buys24h: number;
  sells24h: number;
  /** 24h price change of the deepest pool, in basis points (−10000 = −100%). */
  priceChange24hBps: number | null;
  pairs: number;
}

export class DexScreenerApi {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 6_000,
  ) {}

  async tokenVolumes(mints: string[]): Promise<Map<string, TokenVolume>> {
    const unique = [...new Set(mints)].filter((m) => base58.safeParse(m).success);
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += BATCH) batches.push(unique.slice(i, i + BATCH));
    const results = await Promise.allSettled(batches.map((b) => this.batch(b)));
    const out = new Map<string, TokenVolume>();
    for (const r of results) if (r.status === "fulfilled") for (const [k, v] of r.value) out.set(k, v);
    if (batches.length > 0 && out.size === 0) {
      const first = results.find((r) => r.status === "rejected");
      throw first?.reason instanceof Error ? first.reason : new Error("DexScreener requests failed");
    }
    return out;
  }

  private async batch(batch: string[]): Promise<Map<string, TokenVolume>> {
    const wanted = new Set(batch);
    const url = new URL(`/tokens/v1/solana/${batch.join(",")}`, this.baseUrl);
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 4_000_000) throw new Error("DexScreener response too large");
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) throw new Error("DexScreener returned an unexpected shape");
    // Money is summed in integer cents / lamports so repeated additions never drift.
    type Acc = { vol: bigint; liq: bigint; liqSol: bigint; mcap: number; buys: number; sells: number; deepest: number; change: number | null; pairs: number };
    const acc = new Map<string, Acc>();
    const seenPairs = new Set<string>();
    for (const item of raw) {
      const p = pairSchema.safeParse(item);
      if (!p.success) continue;
      const { baseToken, quoteToken, pairAddress, volume, liquidity, txns, priceChange, marketCap, fdv } = p.data;
      if (!wanted.has(baseToken.address) || seenPairs.has(pairAddress)) continue;
      seenPairs.add(pairAddress);
      const a = acc.get(baseToken.address) ?? { vol: 0n, liq: 0n, liqSol: 0n, mcap: 0, buys: 0, sells: 0, deepest: -1, change: null, pairs: 0 };
      a.vol += cents(volume?.h24);
      a.liq += cents(liquidity?.usd);
      if (quoteToken?.address === WSOL) a.liqSol += BigInt(Math.round((liquidity?.quote ?? 0) * 1e9));
      a.mcap = Math.max(a.mcap, marketCap ?? fdv ?? 0);
      a.buys += txns?.h24?.buys ?? 0;
      a.sells += txns?.h24?.sells ?? 0;
      if ((liquidity?.usd ?? 0) > a.deepest) {
        a.deepest = liquidity?.usd ?? 0;
        a.change = priceChange?.h24 ?? null;
      }
      a.pairs += 1;
      acc.set(baseToken.address, a);
    }
    const out = new Map<string, TokenVolume>();
    for (const mint of batch) {
      const a = acc.get(mint);
      // A coin with no pairs is recorded as empty, so stale numbers never keep it listed.
      out.set(mint, {
        volume24hUsd: fromCents(a?.vol ?? 0n),
        liquidityUsd: fromCents(a?.liq ?? 0n),
        liquiditySolLamports: a?.liqSol ?? 0n,
        liquidityMcapBps: a && a.mcap > 0 ? Math.min(1_000_000, Math.floor((Number(a.liq) / 100 / a.mcap) * 10_000)) : null,
        buys24h: a?.buys ?? 0,
        sells24h: a?.sells ?? 0,
        priceChange24hBps: a?.change === null || a?.change === undefined ? null : Math.max(-10_000, Math.min(1_000_000_000, Math.round(a.change * 100))),
        pairs: a?.pairs ?? 0,
      });
    }
    return out;
  }
}

const cents = (v: number | null | undefined) => (v ? BigInt(Math.round(v * 100)) : 0n);
const fromCents = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
