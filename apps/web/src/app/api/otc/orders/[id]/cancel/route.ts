import { z } from "zod";
import { cancelOrder } from "@app/otc/server";
import { body, route } from "@/server/http";
import { otcContext } from "@/server/context";
import { zSignature } from "@/server/schemas";

/** POST /api/otc/orders/:id/cancel — wallet-signed cancel. Authorization is the signature + session, checked server-side. */
export const POST = route<{ id: string }>({ auth: "required" }, async ({ req, params, wallet, ip }) => {
  const input = await body(req, z.object({ payload: z.unknown(), signature: zSignature }));
  return cancelOrder(otcContext(), params.id.slice(0, 64), { payload: input.payload, signature: input.signature, viewer: wallet!, ...(ip ? { ip } : {}) });
});
