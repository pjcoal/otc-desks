import { z } from "zod";
import { RATE_LIMITS } from "@app/shared/server";
import { submitSettlement } from "@app/otc/server";
import { body, route } from "@/server/http";
import { otcContext } from "@/server/context";

export const POST = route({ auth: "required", transactional: true, rateLimit: RATE_LIMITS.settlement }, async ({ req, wallet }) => {
  const { settlementId } = await body(req, z.object({ settlementId: z.string().min(1).max(64) }));
  return submitSettlement(otcContext(), settlementId, wallet!);
});
