import { z } from "zod";
import { getDb } from "@app/database";
import { isBase58PublicKey } from "@app/shared";
import { RATE_LIMITS } from "@app/shared/server";
import { searchTokens } from "@app/market";
import { route, query } from "@/server/http";
import { config, registry } from "@/server/context";

/** GET /api/tokens/search?q= — name / ticker / mint. A mint always resolves (fetched from chain if unknown). */
export const GET = route({ rateLimit: RATE_LIMITS.search }, async ({ req }) => {
  const { q } = query(req, z.object({ q: z.string().trim().min(1).max(64) }));
  let results = await searchTokens(getDb(), q, config().DEMO_MODE);
  if (results.length === 0 && isBase58PublicKey(q)) {
    const t = await registry().ensureToken(q).catch(() => null);
    if (t) results = await searchTokens(getDb(), q, config().DEMO_MODE);
  }
  return { results };
});
