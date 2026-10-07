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
  /** All-time global fees floor. Null = rule off (no Birdeye key, or threshold 0). */
  minGlobalFeesLamports: Prisma.Decimal | null;
  /** Chart-quality floors (rugs, faked charts). Null = rule off (no DexScreener data source). */
  quality: { minLiquiditySolLamports: Prisma.Decimal; minLiquidityMcapBps: number; minSellBuyBps: number; minPriceChange24hBps: number } | null;
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
    minGlobalFeesLamports: config.BIRDEYE_API_KEY && config.LISTING_MIN_GLOBAL_FEES_SOL > 0 ? new Prisma.Decimal(new D(config.LISTING_MIN_GLOBAL_FEES_SOL).mul(1e9).toFixed(0, D.ROUND_UP)) : null,
    quality: config.DEXSCREENER_API
      ? {
          minLiquiditySolLamports: new Prisma.Decimal(new D(config.LISTING_MIN_LIQUIDITY_SOL).mul(1e9).toFixed(0, D.ROUND_UP)),
          minLiquidityMcapBps: Math.ceil(config.LISTING_MIN_LIQ_MCAP_PCT * 100),
          minSellBuyBps: Math.ceil(config.LISTING_MIN_SELL_BUY_RATIO * 10_000),
          minPriceChange24hBps: -Math.floor(config.LISTING_MAX_DROP_24H_PCT * 100),
        }
      : null,
    freshSince: new Date(now - VOLUME_FRESH_MS),
  };
}

/**
 * Recent coins are listed once their market cap reaches the floor; older coins need fresh 24h volume
 * above the floor (from the listing-stats source or from our own indexer). Both must also pass the
 * chart-quality rules (when on) and the global-fees rule (when on). Coins launched through this site
 * are always listed. If the SOL/USD price is unknown, the USD floors cannot be converted and only the
 * USD-denominated volume rule applies (fail closed).
 */
export function listedWhere(r: ListingRules | null): Prisma.TokenWhereInput {
  if (!r) return {};
  const extra: Prisma.MarketStateWhereInput[] = [];
  if (r.minGlobalFeesLamports) extra.push({ globalFeesLamports: { gte: r.minGlobalFeesLamports } });
  if (r.quality) {
    const q = r.quality;
    // Signals must be fresh: a coin whose data stopped refreshing drops out rather than keeping old numbers.
    extra.push(
      { volume24hUsdAt: { gte: r.freshSince } },
      { liquiditySolLamports: { gte: q.minLiquiditySolLamports } },
      { liquidityMcapBps: { gte: q.minLiquidityMcapBps } },
      { sellBuyBps: { gte: q.minSellBuyBps } },
      { OR: [{ priceChange24hBps: null }, { priceChange24hBps: { gte: q.minPriceChange24hBps } }] },
    );
  }
  const volume: Prisma.MarketStateWhereInput[] = [{ volume24hUsd: { gte: r.minVolumeUsd }, volume24hUsdAt: { gte: r.freshSince } }];
  if (r.minVolumeLamports) volume.push({ volume24hLamports: { gte: r.minVolumeLamports }, updatedAt: { gte: r.freshSince } });
  const or: Prisma.TokenWhereInput[] = [{ launchedViaPlatform: true }, { createdAt: { lt: r.recentSince }, market: { AND: [{ OR: volume }, ...extra] } }];
  if (r.minMcapLamports) or.push({ createdAt: { gte: r.recentSince }, market: { AND: [{ marketCapLamports: { gte: r.minMcapLamports } }, ...extra] } });
  return { OR: or };
}
