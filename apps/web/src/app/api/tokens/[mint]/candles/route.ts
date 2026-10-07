import { z } from "zod";
import { getDb } from "@app/database";
import { TIMEFRAMES, candles } from "@app/market";
import { route, query } from "@/server/http";
import { zAddress } from "@/server/schemas";

export const GET = route<{ mint: string }>({}, async ({ req, params }) => {
  const mint = zAddress.parse(params.mint);
  const { tf } = query(req, z.object({ tf: z.enum(Object.keys(TIMEFRAMES) as [keyof typeof TIMEFRAMES]).default("15m") }));
  return candles(getDb(), mint, tf);
});
