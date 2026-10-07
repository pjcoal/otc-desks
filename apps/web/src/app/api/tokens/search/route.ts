import { z } from "zod";
import { getDb } from "@app/database";
import { isBase58PublicKey } from "@app/shared";
import { RATE_LIMITS } from "@app/shared/server";
import { searchTokens } from "@app/market";
import { route, query } from "@/server/http";
import { registry } from "@/server/context";

/** GET /api/tokens/search?q= — name / ticker (listed coins only) / mint. A mint always resolves (fetched from chain if unknown). */
export const GET = route({ rateLimit: RATE_LIMITS.search }, async ({ req }) => {
  const { q } = query(req, z.object({ q: z.string().trim().min(1).max(64) }));
  const rules = await registry().listingRules();
  let results = await searchTokens(getDb(), q, 12, rules);
  if (results.length === 0 && isBase58PublicKey(q)) {
    const t = await registry().ensureToken(q).catch(() => null);
    if (t) results = await searchTokens(getDb(), q, 12, rules);
  }
  return { results };
});
