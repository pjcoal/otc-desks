import { z } from "zod";
import { getDb } from "@app/database";
import { recentOtcTrades } from "@app/market";
import { query, route } from "@/server/http";
import { config } from "@/server/context";
import { zAddress } from "@/server/schemas";

export const GET = route({}, async ({ req }) => {
  const q = query(req, z.object({ mint: zAddress.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }));
  return { trades: await recentOtcTrades(getDb(), { ...(q.mint ? { mint: q.mint } : {}), includeDemo: config().DEMO_MODE, limit: q.limit }) };
});
