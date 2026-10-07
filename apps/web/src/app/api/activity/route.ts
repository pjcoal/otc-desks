import { getDb } from "@app/database";
import { recentOtcTrades } from "@app/market";
import { route } from "@/server/http";
import { config } from "@/server/context";

/** GET /api/activity — platform-wide public activity: launches, OTC block trades, new public orders. */
export const GET = route({}, async () => {
  const db = getDb();
  const demo = config().DEMO_MODE ? {} : { isDemo: false };
  const [launches, trades, orders] = await Promise.all([
    db.token.findMany({ where: { ...demo, launchedViaPlatform: true }, orderBy: { createdAt: "desc" }, take: 10, select: { mint: true, symbol: true, name: true, imageUrl: true, createdAt: true, creator: true, isDemo: true } }),
    recentOtcTrades(db, { includeDemo: config().DEMO_MODE, limit: 10 }),
    db.otcOrder.findMany({ where: { ...demo, takerWallet: null, status: { in: ["OPEN", "PARTIALLY_FILLED"] }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 10, include: { token: { select: { symbol: true, imageUrl: true } } } }),
  ]);
  return {
    launches,
    otcTrades: trades,
    orders: orders.map((o) => ({ id: o.id, publicId: o.publicId, side: o.side, tokenMint: o.tokenMint, symbol: o.token.symbol, imageUrl: o.token.imageUrl, tokenDecimals: o.tokenDecimals, tokenAmountRaw: o.tokenAmountRaw.toFixed(0), quoteAmountRaw: o.quoteAmountRaw.toFixed(0), priceSolPerToken: o.priceDecimal.toFixed(), refPriceSolPerToken: o.refPriceSolPerToken?.toFixed() ?? null, createdAt: o.createdAt.toISOString(), makerWallet: o.makerWallet, isDemo: o.isDemo })),
  };
});
