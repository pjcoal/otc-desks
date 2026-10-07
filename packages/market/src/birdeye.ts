/**
 * OPTIONAL listing-stats source: Birdeye "Global Fees Paid" (`GET /defi/v3/token/fee/multiple`,
 * Business plan or higher). All-time fees traders paid on a coin: trading-platform fees, priority
 * fees, tips and network fees, in SOL. Used only to decide which coins are listed.
 * Responses are untrusted: validated, size-limited, and malformed entries are dropped.
 */
import { z } from "zod";
import { D } from "@app/shared";

/** Batch CU cost is ceil(5 × count^0.8), so larger batches are cheaper per coin. */
const BATCH = 50;
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const sol = z.number().nonnegative().max(1e12);

const entrySchema = z.object({ alltime: z.object({ summary: z.object({ sum_global_fee_paid_amount_sol: sol }) }) });
const responseSchema = z.object({ success: z.literal(true), data: z.record(z.string(), z.unknown()) });

export class BirdeyeApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 8_000,
  ) {}

  /** All-time global fees paid per mint, in lamports. Mints Birdeye has no data for are absent. */
  async globalFeesLamports(mints: string[]): Promise<Map<string, bigint>> {
    const unique = [...new Set(mints)].filter((m) => base58.safeParse(m).success);
    const out = new Map<string, bigint>();
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const url = new URL("/defi/v3/token/fee/multiple", this.baseUrl);
      // The docs name the timeframe parameter both `interval` and `list_timeframe`; send both.
      url.search = new URLSearchParams({ list_address: batch.join(","), interval: "alltime", list_timeframe: "alltime" }).toString();
      const res = await fetch(url, { headers: { accept: "application/json", "x-api-key": this.apiKey, "x-chain": "solana" }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`Birdeye HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > 4_000_000) throw new Error("Birdeye response too large");
      const parsed = responseSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error("Birdeye returned an unexpected shape");
      for (const mint of batch) {
        const e = entrySchema.safeParse(parsed.data.data[mint]);
        if (!e.success) continue;
        out.set(mint, BigInt(new D(e.data.alltime.summary.sum_global_fee_paid_amount_sol.toString()).mul(1e9).toFixed(0, D.ROUND_DOWN)));
      }
    }
    return out;
  }
}
