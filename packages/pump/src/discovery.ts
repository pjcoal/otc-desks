/**
 * OPTIONAL token-discovery source: Pump.fun's website backend (`frontend-api-v3.pump.fun`).
 *
 * This is NOT an official or documented API. It is used only to discover which coins exist and to
 * show names/images in lists, behind this adapter, on mainnet, when PUMP_DISCOVERY_API=true.
 * Prices on token pages, balances, quotes, trades and settlement always come from the chain.
 * Every record is treated as untrusted input: validated, size-limited, and dropped if malformed.
 */
import { z } from "zod";

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const uint = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,20}$/)]).transform((v) => BigInt(v));

const coinSchema = z.object({
  mint: base58,
  name: z.string().max(200),
  symbol: z.string().max(100),
  description: z.string().max(5000).nullish(),
  image_uri: z.string().max(1000).nullish(),
  metadata_uri: z.string().max(1000).nullish(),
  creator: base58.nullish(),
  created_timestamp: z.number().int().positive(),
  complete: z.boolean(),
  virtual_sol_reserves: uint,
  virtual_token_reserves: uint,
  real_token_reserves: uint.nullish(),
  base_decimals: z.number().int().min(0).max(18).nullish(),
  pool_address: base58.nullish(),
  last_trade_timestamp: z.number().int().positive().nullish(),
  market_cap: z.number().nonnegative().nullish(),
  nsfw: z.boolean().nullish(),
  is_banned: z.boolean().nullish(),
});

export interface DiscoveredCoin {
  mint: string;
  name: string;
  symbol: string;
  description: string | null;
  imageUri: string | null;
  metadataUri: string | null;
  creator: string | null;
  createdAt: Date;
  lastTradeAt: Date | null;
  complete: boolean;
  poolAddress: string | null;
  decimals: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realTokenReserves: bigint | null;
  /** SOL market cap as reported by the API (a float there; display/approximation only). */
  apiMarketCapSol: string | null;
}

export type DiscoverySort = "created_timestamp" | "last_trade_timestamp" | "market_cap";

export class PumpDiscoveryApi {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 6_000,
  ) {}

  async listCoins(sort: DiscoverySort, limit = 50, offset = 0): Promise<DiscoveredCoin[]> {
    const url = new URL("/coins", this.baseUrl);
    url.search = new URLSearchParams({ offset: String(offset), limit: String(Math.min(limit, 50)), sort, order: "DESC", includeNsfw: "false" }).toString();
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`Pump discovery API HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 2_000_000) throw new Error("Pump discovery API response too large");
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) throw new Error("Pump discovery API returned an unexpected shape");
    const out: DiscoveredCoin[] = [];
    for (const item of raw) {
      const p = coinSchema.safeParse(item);
      if (!p.success) continue; // malformed records are dropped, never trusted partially
      const c = p.data;
      if (c.is_banned || c.nsfw) continue;
      out.push({
        mint: c.mint,
        name: c.name.trim().slice(0, 64),
        symbol: c.symbol.trim().slice(0, 16),
        description: c.description?.slice(0, 1000) ?? null,
        imageUri: c.image_uri ?? null,
        metadataUri: c.metadata_uri ?? null,
        creator: c.creator ?? null,
        createdAt: new Date(c.created_timestamp),
        lastTradeAt: c.last_trade_timestamp ? new Date(c.last_trade_timestamp) : null,
        complete: c.complete,
        poolAddress: c.pool_address ?? null,
        decimals: c.base_decimals ?? 6,
        virtualSolReserves: c.virtual_sol_reserves,
        virtualTokenReserves: c.virtual_token_reserves,
        realTokenReserves: c.real_token_reserves ?? null,
        apiMarketCapSol: c.market_cap === null || c.market_cap === undefined ? null : c.market_cap.toFixed(9),
      });
    }
    return out;
  }
}
