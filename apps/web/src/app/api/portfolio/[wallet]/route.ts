import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { D } from "@app/shared";
import { big, getDb } from "@app/database";
import { getRpc } from "@app/solana/server";
import { recentOtcTrades } from "@app/market";
import { listOrders } from "@app/otc/server";
import { route } from "@/server/http";
import { config, otcContext } from "@/server/context";
import { zAddress } from "@/server/schemas";

/**
 * GET /api/portfolio/:wallet — balances from chain, values from our indexed Pump prices (estimates).
 * Private data (open private orders, negotiations) only for the wallet's own signed-in session.
 * PnL is reported ONLY when the wallet's indexed trades fully explain its current balance; otherwise
 * cost basis is explicitly "unavailable" rather than invented.
 */
export const GET = route<{ wallet: string }>({ auth: "optional" }, async ({ params, wallet: viewer }) => {
  const owner = zAddress.parse(params.wallet);
  const isSelf = viewer === owner;
  const db = getDb();
  const conn = getRpc().connection;
  const key = new PublicKey(owner);
  const [lamports, spl, t22] = await Promise.all([
    conn.getBalance(key),
    conn.getParsedTokenAccountsByOwner(key, { programId: TOKEN_PROGRAM_ID }),
    conn.getParsedTokenAccountsByOwner(key, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  const holdings = [...spl.value, ...t22.value]
    .map((a) => {
      const info = (a.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } }).parsed.info;
      return { mint: info.mint, amountRaw: BigInt(info.tokenAmount.amount), decimals: info.tokenAmount.decimals };
    })
    .filter((h) => h.amountRaw > 0n);
  const tokens = await db.token.findMany({ where: { mint: { in: holdings.map((h) => h.mint) } }, include: { market: true } });
  const byMint = new Map(tokens.map((t) => [t.mint, t]));
  const positions = [];
  for (const h of holdings) {
    const t = byMint.get(h.mint);
    if (!t) continue; // only Pump tokens we track
    const price = t.market ? new D(t.market.priceSolPerToken.toFixed()) : null;
    const valueLamports = price ? new D(h.amountRaw.toString()).div(new D(10).pow(h.decimals)).mul(price).mul(1e9).toFixed(0, D.ROUND_DOWN) : null;
    const trades = await db.trade.findMany({ where: { mint: h.mint, trader: owner, isDemo: false } });
    const bought = trades.filter((x) => x.side === "BUY").reduce((a, x) => a + big(x.tokenAmount), 0n);
    const sold = trades.filter((x) => x.side === "SELL").reduce((a, x) => a + big(x.tokenAmount), 0n);
    const spent = trades.filter((x) => x.side === "BUY").reduce((a, x) => a + big(x.solAmount), 0n);
    const received = trades.filter((x) => x.side === "SELL").reduce((a, x) => a + big(x.solAmount), 0n);
    const explained = trades.length > 0 && bought - sold === h.amountRaw;
    const pnl = explained && valueLamports ? (BigInt(valueLamports) + received - spent).toString() : null;
    positions.push({
      mint: h.mint,
      symbol: t.symbol,
      name: t.name,
      imageUrl: t.imageUrl,
      decimals: h.decimals,
      balanceRaw: h.amountRaw.toString(),
      venue: t.market?.venue ?? t.venue,
      priceSolPerToken: price?.toFixed() ?? null,
      estimatedValueLamports: valueLamports,
      pnlLamports: pnl,
      costBasisNote: explained ? "Derived from indexed Pump/PumpSwap trades." : "Unavailable: this balance includes transfers or trades outside our index.",
      isDemo: t.isDemo,
    });
  }
  const ctx = otcContext();
  const [openOrders, created, history] = await Promise.all([
    listOrders(ctx, { maker: owner, mine: isSelf, status: ["OPEN", "NEGOTIATING", "ACCEPTED", "SETTLEMENT_READY", "PARTIALLY_FILLED"], limit: 50 }, isSelf ? owner : null),
    db.token.findMany({ where: { creator: owner }, orderBy: { createdAt: "desc" }, take: 50, include: { market: true } }),
    recentOtcTrades(db, { wallet: owner, includeDemo: config().DEMO_MODE, limit: 50, publicOnly: !isSelf }),
  ]);
  return {
    wallet: owner,
    isSelf,
    solLamports: String(lamports),
    positions,
    openOrders: openOrders.items,
    otcHistory: history,
    createdTokens: created.map((t) => ({ mint: t.mint, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl, venue: t.market?.venue ?? t.venue, createdAt: t.createdAt.toISOString(), marketCapLamports: t.market?.marketCapLamports.toFixed(0) ?? null })),
  };
});
