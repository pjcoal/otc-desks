import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@app/database";
import { explore } from "@app/market";
import { route, query } from "@/server/http";
import { registry } from "@/server/context";

const SECTIONS = ["launched_here", "trending", "new", "near_graduation", "recently_graduated", "most_otc", "largest_discounts", "largest_otc_trades"] as const;

/** GET /api/tokens?section=trending — discovery sections, real indexed data only, filtered by the listing rules. */
export const GET = route({}, async ({ req }) => {
  const q = query(req, z.object({ section: z.enum(SECTIONS).default("trending"), limit: z.coerce.number().int().min(1).max(48).default(24) }));
  // Mainnet + PUMP_DISCOVERY_API only; at most once a minute. Runs after the response is sent.
  after(() => registry().syncDiscovery().catch(() => null));
  return explore(getDb(), q.section, q.limit, await registry().listingRules());
});
