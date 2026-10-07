import { Prisma } from "@app/database";
import { D } from "@app/shared";
import type { ServerConfig } from "@app/shared/server";

/** Volume figures older than this no longer count towards listing. */
const VOLUME_FRESH_MS = 2 * 60 * 60 * 1000;

export interface ListingRules {
  recentSince: Date;
  /** Market-cap floor for recent coins, converted to lamports at the current SOL/USD price. Null = price unknown. */
  minMcapLamports: Prisma.Decimal | null;
  minVolumeUsd: Prisma.Decimal;
  /** Volume floor in lamports for indexer-measured volume. Null = price unknown. */
  minVolumeLamports: Prisma.Decimal | null;
  freshSince: Date;
}

/**
 * Which coins appear in discovery lists. Mainnet only: on test clusters coins have no USD value and
 * every coin is listed. Returns null when no filtering applies.
 */
export function listingRules(config: ServerConfig, solUsd: string | null, now = Date.now()): ListingRules | null {
  if (!config.isMainnet) return null;
  const toLamports = (usd: number) => (solUsd ? new Prisma.Decimal(new D(usd).div(solUsd).mul(1e9).toFixed(0, D.ROUND_UP)) : null);
  return {
    recentSince: new Date(now - config.LISTING_RECENT_HOURS * 3600 * 1000),
    minMcapLamports: toLamports(config.LISTING_MIN_MCAP_USD),
    minVolumeUsd: new Prisma.Decimal(config.LISTING_MIN_VOLUME_USD),
    minVolumeLamports: toLamports(config.LISTING_MIN_VOLUME_USD),
    freshSince: new Date(now - VOLUME_FRESH_MS),
  };
}

/**
 * Recent coins are listed once their market cap reaches the floor; older coins need fresh 24h volume
 * above the floor (from the listing-stats source or from our own indexer). Coins launched through this
 * site are always listed. If the SOL/USD price is unknown, the USD floors cannot be converted and only
 * the USD-denominated volume rule applies (fail closed).
 */
export function listedWhere(r: ListingRules | null): Prisma.TokenWhereInput {
  if (!r) return {};
  const volume: Prisma.MarketStateWhereInput[] = [{ volume24hUsd: { gte: r.minVolumeUsd }, volume24hUsdAt: { gte: r.freshSince } }];
  if (r.minVolumeLamports) volume.push({ volume24hLamports: { gte: r.minVolumeLamports }, updatedAt: { gte: r.freshSince } });
  const or: Prisma.TokenWhereInput[] = [{ launchedViaPlatform: true }, { createdAt: { lt: r.recentSince }, market: { OR: volume } }];
  if (r.minMcapLamports) or.push({ createdAt: { gte: r.recentSince }, market: { marketCapLamports: { gte: r.minMcapLamports } } });
  return { OR: or };
}
