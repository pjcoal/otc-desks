import { z } from "zod";
import { RATE_LIMITS } from "@app/shared/server";
import { pumpTradeFees } from "@app/pump";
import { route, query } from "@/server/http";
import { registry } from "@/server/context";
import { serializeQuote } from "@/server/tx";
import { zAddress, zSlippageBps, zU64 } from "@/server/schemas";

/** GET /api/quotes/sell?mint&amount&slippageBps — what selling into Pump/PumpSwap right now would return (estimate). */
export const GET = route({ rateLimit: RATE_LIMITS.quote }, async ({ req }) => {
  const q = query(req, z.object({ mint: zAddress, amount: zU64, slippageBps: zSlippageBps.default(100) }));
  const quote = await registry().pump.quoteSell(q.mint, BigInt(q.amount), q.slippageBps);
  const market = await registry().pump.getMarket(q.mint);
  return { quote: serializeQuote(quote), fees: pumpTradeFees(market, quote).map(serializeQuote) };
});
