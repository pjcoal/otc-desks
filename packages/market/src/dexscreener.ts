/**
 * OPTIONAL listing-stats source: DexScreener's public API (`/tokens/v1/{chain}/{addresses}`, up to 30
 * addresses per request, 300 requests/min). Used only to decide which coins are listed and to show
 * 24h volume. Prices on token pages, quotes, trades and settlement always come from the chain.
 * Responses are untrusted: validated, size-limited, and malformed pairs are dropped.
 */
import { z } from "zod";

const BATCH = 30;
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const usd = z.number().nonnegative().max(1e15);

const pairSchema = z.object({
  chainId: z.literal("solana"),
  dexId: z.string().max(64),
  pairAddress: base58,
  baseToken: z.object({ address: base58 }),
  volume: z.object({ h24: usd.nullish() }).nullish(),
  liquidity: z.object({ usd: usd.nullish() }).nullish(),
});

export interface TokenVolume {
  /** Sum of 24h volume across every pair where the coin is the base token, in USD (2-dp decimal string). */
  volume24hUsd: string;
  liquidityUsd: string;
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
    // Summed in cents as integers so repeated additions never drift.
    const acc = new Map<string, { vol: bigint; liq: bigint; pairs: number }>();
    const seenPairs = new Set<string>();
    for (const item of raw) {
      const p = pairSchema.safeParse(item);
      if (!p.success) continue;
      const { baseToken, pairAddress, volume, liquidity } = p.data;
      if (!wanted.has(baseToken.address) || seenPairs.has(pairAddress)) continue;
      seenPairs.add(pairAddress);
      const a = acc.get(baseToken.address) ?? { vol: 0n, liq: 0n, pairs: 0 };
      a.vol += cents(volume?.h24);
      a.liq += cents(liquidity?.usd);
      a.pairs += 1;
      acc.set(baseToken.address, a);
    }
    const out = new Map<string, TokenVolume>();
    for (const mint of batch) {
      const a = acc.get(mint);
      // A coin with no pairs is recorded as zero volume, so stale numbers never keep it listed.
      out.set(mint, { volume24hUsd: fromCents(a?.vol ?? 0n), liquidityUsd: fromCents(a?.liq ?? 0n), pairs: a?.pairs ?? 0 });
    }
    return out;
  }
}

const cents = (v: number | null | undefined) => (v ? BigInt(Math.round(v * 100)) : 0n);
const fromCents = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
