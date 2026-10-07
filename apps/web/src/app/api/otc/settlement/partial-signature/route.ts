import { z } from "zod";
import { RATE_LIMITS } from "@app/shared/server";
import { submitPartialSignature } from "@app/otc/server";
import { body, route } from "@/server/http";
import { otcContext } from "@/server/context";

export const POST = route({ auth: "required", transactional: true, rateLimit: RATE_LIMITS.settlement }, async ({ req, wallet }) => {
  const input = await body(req, z.object({ settlementId: z.string().min(1).max(64), signedTransactionBase64: z.string().min(1).max(4096) }));
  return submitPartialSignature(otcContext(), input.settlementId, { signedTransactionBase64: input.signedTransactionBase64, viewer: wallet! });
});
