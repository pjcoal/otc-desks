import { type Prisma, type Db } from "@app/database";
import { isBase58PublicKey } from "@app/shared";

export const TIMEFRAMES = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 } as const;
export type Timeframe = keyof typeof TIMEFRAMES;

export interface Candle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeLamports: string;
  trades: number;
}

/**
 * OHLCV from indexed Pump/PumpSwap trades only. Buckets with no trades are simply absent — we never
 * synthesise candles. `coverageFrom` reports the earliest indexed trade so the UI can be honest.
 */
export async function candles(db: Db, mint: string, tf: Timeframe, limit = 300): Promise<{ candles: Candle[]; coverageFrom: string | null }> {
  const seconds = TIMEFRAMES[tf];
  const rows = await db.$queryRaw<Array<{ bucket: Date; open: Prisma.Decimal; high: Prisma.Decimal; low: Prisma.Decimal; close: Prisma.Decimal; volume: Prisma.Decimal; trades: bigint }>>`
    SELECT bucket,
           (array_agg("priceSolPerToken" ORDER BY "blockTime", "eventIndex"))[1] AS open,
           max("priceSolPerToken") AS high,
           min("priceSolPerToken") AS low,
           (array_agg("priceSolPerToken" ORDER BY "blockTime" DESC, "eventIndex" DESC))[1] AS close,
           sum("solAmount") AS volume,
           count(*) AS trades
    FROM (
      SELECT *, date_bin(make_interval(secs => ${seconds}), "blockTime", TIMESTAMPTZ '2020-01-01') AS bucket
      FROM "Trade" WHERE mint = ${mint}
    ) t
    GROUP BY bucket ORDER BY bucket DESC LIMIT ${limit}`;
  // Per-mint queries need no demo filter: a mint's trades are either all real or all demo (DEMO_MODE seed).
  const first = await db.trade.findFirst({ where: { mint }, orderBy: { blockTime: "asc" }, select: { blockTime: true } });
  return {
    candles: rows.reverse().map((r) => ({
      time: Math.floor(r.bucket.getTime() / 1000),
      open: r.open.toFixed(),
      high: r.high.toFixed(),
      low: r.low.toFixed(),
      close: r.close.toFixed(),
      volumeLamports: r.volume.toFixed(0),
      trades: Number(r.trades),
    })),
    coverageFrom: first?.blockTime.toISOString() ?? null,
  };
}

export async function recentTrades(db: Db, mint: string, limit = 50) {
  const rows = await db.trade.findMany({ where: { mint }, orderBy: [{ blockTime: "desc" }, { eventIndex: "desc" }], take: limit });
  return rows.map((t) => ({
    signature: t.signature,
    side: t.side,
    trader: t.trader,
    solAmount: t.solAmount.toFixed(0),
    tokenAmount: t.tokenAmount.toFixed(0),
    priceSolPerToken: t.priceSolPerToken.toFixed(),
    venue: t.venue,
    blockTime: t.blockTime.toISOString(),
    commitment: t.commitment,
  }));
}

const tokenCard = { mint: true, name: true, symbol: true, imageUrl: true, decimals: true, venue: true, complete: true, createdAt: true, graduatedAt: true, creator: true, isDemo: true, market: true } as const;

export type SearchResult = Awaited<ReturnType<typeof searchTokens>>[number];

/** Mint addresses always resolve directly (exact key lookup); text search uses prefix/contains on indexed columns. */
export async function searchTokens(db: Db, q: string, includeDemo: boolean, limit = 12) {
  const term = q.trim().slice(0, 64);
  if (term.length === 0) return [];
  if (isBase58PublicKey(term)) {
    const exact = await db.token.findUnique({ where: { mint: term }, select: tokenCard });
    return exact ? [exact] : [];
  }
  return db.token.findMany({
    where: {
      ...(includeDemo ? {} : { isDemo: false }),
      OR: [{ symbol: { startsWith: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }],
    },
    select: tokenCard,
    orderBy: [{ lastTradeAt: { sort: "desc", nulls: "last" } }],
    take: limit,
  });
}

export type ExploreSection = "trending" | "new" | "near_graduation" | "recently_graduated" | "most_otc" | "largest_discounts" | "largest_otc_trades";

export async function explore(db: Db, section: ExploreSection, includeDemo: boolean, limit = 24) {
  const demo = includeDemo ? {} : { isDemo: false };
  switch (section) {
    case "trending":
      return {
        kind: "tokens" as const,
        items: await db.token.findMany({
          where: { ...demo, lastTradeAt: { gte: new Date(Date.now() - 86_400_000) } },
          select: tokenCard,
          orderBy: [{ market: { volume24hLamports: "desc" } }, { lastTradeAt: "desc" }],
          take: limit,
        }),
      };
    case "new":
      return { kind: "tokens" as const, items: await db.token.findMany({ where: demo, select: tokenCard, orderBy: { createdAt: "desc" }, take: limit }) };
    case "near_graduation":
      return {
        kind: "tokens" as const,
        items: await db.token.findMany({ where: { ...demo, venue: "PUMP_BONDING_CURVE", market: { bondingProgressBps: { gte: 5000, lt: 10_000 } } }, select: tokenCard, orderBy: { market: { bondingProgressBps: "desc" } }, take: limit }),
      };
    case "recently_graduated":
      return { kind: "tokens" as const, items: await db.token.findMany({ where: { ...demo, venue: "PUMPSWAP", graduatedAt: { not: null } }, select: tokenCard, orderBy: { graduatedAt: "desc" }, take: limit }) };
    case "most_otc": {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const grouped = await db.otcOrder.groupBy({ by: ["tokenMint"], where: { ...demo, takerWallet: null, createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { tokenMint: "desc" } }, take: limit });
      const tokens = await db.token.findMany({ where: { mint: { in: grouped.map((g) => g.tokenMint) } }, select: tokenCard });
      const byMint = new Map(tokens.map((t) => [t.mint, t]));
      return { kind: "otc_activity" as const, items: grouped.map((g) => ({ token: byMint.get(g.tokenMint) ?? null, orders7d: g._count._all })).filter((g) => g.token) };
    }
    case "largest_discounts": {
      // Open public asks priced below the reference price captured at receipt (estimates, labelled as such).
      const rows = await db.$queryRaw<Array<{ id: string; tokenMint: string; discount: Prisma.Decimal }>>`
        SELECT id, "tokenMint", (("priceDecimal" - "refPriceSolPerToken") / "refPriceSolPerToken" * 100) AS discount
        FROM "OtcOrder"
        WHERE status IN ('OPEN','PARTIALLY_FILLED') AND side = 'SELL' AND "takerWallet" IS NULL AND "expiresAt" > now()
          AND "refPriceSolPerToken" > 0 AND (${includeDemo} OR "isDemo" = false)
        ORDER BY discount ASC LIMIT ${limit}`;
      const orders = await db.otcOrder.findMany({ where: { id: { in: rows.map((r) => r.id) } }, include: { token: true } });
      const byId = new Map(orders.map((o) => [o.id, o]));
      return { kind: "otc_orders" as const, items: rows.map((r) => ({ order: byId.get(r.id)!, discountPct: r.discount.toFixed(2) })).filter((r) => r.order) };
    }
    case "largest_otc_trades": {
      const s = await db.otcSettlement.findMany({ where: { ...demo, status: { in: ["CONFIRMED", "FINALIZED"] } }, orderBy: { grossQuoteLamports: "desc" }, take: limit });
      const tokens = await db.token.findMany({ where: { mint: { in: s.map((x) => x.tokenMint) } }, select: tokenCard });
      const byMint = new Map(tokens.map((t) => [t.mint, t]));
      return { kind: "otc_trades" as const, items: s.map((x) => ({ settlement: x, token: byMint.get(x.tokenMint) ?? null })) };
    }
  }
}

export async function recentOtcTrades(db: Db, opts: { mint?: string; wallet?: string; includeDemo: boolean; limit?: number; publicOnly?: boolean }) {
  const rows = await db.otcSettlement.findMany({
    where: {
      status: { in: ["CONFIRMED", "FINALIZED"] },
      ...(opts.includeDemo ? {} : { isDemo: false }),
      ...(opts.mint ? { tokenMint: opts.mint } : {}),
      ...(opts.wallet ? { OR: [{ sellerWallet: opts.wallet }, { buyerWallet: opts.wallet }] } : {}),
      // Trades from private deals are public on-chain, but we only list them to their own parties.
      ...(opts.wallet && !opts.publicOnly ? {} : { order: { takerWallet: null } }),
    },
    orderBy: { blockTime: "desc" },
    take: opts.limit ?? 20,
  });
  const tokens = await db.token.findMany({ where: { mint: { in: [...new Set(rows.map((r) => r.tokenMint))] } } });
  const byMint = new Map(tokens.map((t) => [t.mint, t]));
  return rows.map((r) => ({
    txSignature: r.txSignature,
    tokenMint: r.tokenMint,
    symbol: byMint.get(r.tokenMint)?.symbol ?? "",
    decimals: r.tokenDecimals,
    tokenAmountRaw: r.tokenAmountRaw.toFixed(0),
    grossQuoteLamports: r.grossQuoteLamports.toFixed(0),
    platformFeeLamports: r.platformFeeLamports.toFixed(0),
    seller: r.sellerWallet,
    buyer: r.buyerWallet,
    refPriceSolPerToken: r.refPriceSolPerToken?.toFixed() ?? null,
    blockTime: r.blockTime?.toISOString() ?? null,
    isDemo: r.isDemo,
  }));
}
