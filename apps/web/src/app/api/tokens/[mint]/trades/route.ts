import { getDb } from "@app/database";
import { recentOtcTrades, recentTrades } from "@app/market";
import { route } from "@/server/http";
import { config } from "@/server/context";
import { zAddress } from "@/server/schemas";

export const GET = route<{ mint: string }>({}, async ({ params }) => {
  const mint = zAddress.parse(params.mint);
  const [market, otc] = await Promise.all([recentTrades(getDb(), mint, 50), recentOtcTrades(getDb(), { mint, includeDemo: config().DEMO_MODE, limit: 20 })]);
  return { market, otc };
});
