import { getDb } from "@app/database";
import { recentOtcTrades } from "@app/market";
import { listOrders } from "@app/otc/server";
import { route } from "@/server/http";
import { config, otcContext } from "@/server/context";
import { zAddress } from "@/server/schemas";

/** GET /api/wallets/:address — public profile. Never includes private offers or negotiations. */
export const GET = route<{ address: string }>({}, async ({ params }) => {
  const address = zAddress.parse(params.address);
  const db = getDb();
  const [created, orders, trades, activity] = await Promise.all([
    db.token.findMany({ where: { creator: address, ...(config().DEMO_MODE ? {} : { isDemo: false }) }, include: { market: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    listOrders(otcContext(), { maker: address, limit: 50 }, null),
    recentOtcTrades(db, { wallet: address, includeDemo: config().DEMO_MODE, limit: 50, publicOnly: true }),
    db.trade.findMany({ where: { trader: address, isDemo: false }, orderBy: { blockTime: "desc" }, take: 30 }),
  ]);
  return {
    address,
    createdTokens: created.map((t) => ({ mint: t.mint, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl, venue: t.venue, createdAt: t.createdAt.toISOString(), marketCapLamports: t.market?.marketCapLamports.toFixed(0) ?? null })),
    publicOrders: orders.items,
    // Only trades from public orders appear on profiles; private deal parties are not exposed.
    otcTrades: trades,
    activity: activity.map((a) => ({ signature: a.signature, mint: a.mint, side: a.side, solAmount: a.solAmount.toFixed(0), tokenAmount: a.tokenAmount.toFixed(0), venue: a.venue, blockTime: a.blockTime.toISOString() })),
  };
});
