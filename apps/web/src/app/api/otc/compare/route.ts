import { z } from "zod";
import { D, SOL_DECIMALS, unitPrice } from "@app/shared";
import { RATE_LIMITS } from "@app/shared/server";
import { computeSettlementAmounts } from "@app/otc";
import { route, query } from "@/server/http";
import { config, registry } from "@/server/context";
import { serializeQuote } from "@/server/tx";
import { zAddress, zU64 } from "@/server/schemas";

/**
 * GET /api/otc/compare — "sell through Pump now" vs "this OTC deal", side by side. Every number is an
 * ESTIMATE from live on-chain state at `quotedAt`; nothing here is a promise of execution.
 */
export const GET = route({ rateLimit: RATE_LIMITS.quote }, async ({ req }) => {
  const q = query(req, z.object({ mint: zAddress, tokenAmount: zU64, quoteLamports: zU64, side: z.enum(["BUY", "SELL"]).default("SELL"), slippageBps: z.coerce.number().int().min(1).max(5000).default(100) }));
  const c = config();
  const tokens = BigInt(q.tokenAmount);
  const otcGross = BigInt(q.quoteLamports);
  const market = await registry().pump.getMarket(q.mint);
  const otc = computeSettlementAmounts({ grossQuote: otcGross, feeBps: c.OTC_PLATFORM_FEE_BPS, feeMode: c.OTC_FEE_MODE, referralShareBps: 0, hasReferrer: false });
  const otcPrice = tokens > 0n ? unitPrice(otcGross, SOL_DECIMALS, tokens, market.decimals) : new D(0);
  const spot = new D(market.priceSolPerToken);
  let marketQuote: Record<string, unknown> | null = null;
  let note: string | null = market.tradable ? null : (market.note ?? "No tradable Pump market right now.");
  if (market.tradable && tokens > 0n) {
    try {
      marketQuote = serializeQuote(q.side === "SELL" ? await registry().pump.quoteSell(q.mint, tokens, q.slippageBps) : await registry().pump.quoteBuy(q.mint, otcGross, q.slippageBps));
    } catch (e) {
      note = e instanceof Error ? e.message : "Market quote unavailable.";
    }
  }
  return {
    estimate: true,
    quotedAt: new Date().toISOString(),
    slot: market.slot,
    venue: market.venue,
    spotPriceSolPerToken: market.priceSolPerToken,
    otc: {
      priceSolPerToken: otcPrice.toFixed(),
      premiumDiscountPct: spot.isZero() ? null : otcPrice.sub(spot).div(spot).mul(100).toFixed(2),
      grossLamports: otc.grossQuote.toString(),
      platformFeeLamports: otc.totalFee.toString(),
      sellerNetLamports: otc.sellerReceives.toString(),
      buyerPaysLamports: otc.buyerPays.toString(),
      feeBps: c.OTC_PLATFORM_FEE_BPS,
      feeMode: c.OTC_FEE_MODE,
    },
    market: marketQuote,
    note,
  };
});
