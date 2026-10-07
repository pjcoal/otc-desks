import { z } from "zod";
import { RATE_LIMITS } from "@app/shared/server";
import { prepareSettlement } from "@app/otc/server";
import { body, route } from "@/server/http";
import { otcContext } from "@/server/context";

export const POST = route({ auth: "required", transactional: true, rateLimit: RATE_LIMITS.settlement }, async ({ req, wallet }) => {
  const { orderId } = await body(req, z.object({ orderId: z.string().min(1).max(64) }));
  return prepareSettlement(otcContext(), orderId, wallet!);
});
