import { z } from "zod";
import { RATE_LIMITS } from "@app/shared/server";
import { ORDER_STATUSES } from "@app/otc";
import { createOrder, listOrders } from "@app/otc/server";
import { body, query, route } from "@/server/http";
import { otcContext } from "@/server/context";
import { zAddress, zLimit, zSignature } from "@/server/schemas";

const signed = z.object({ payload: z.unknown(), signature: zSignature });

/** POST /api/otc/orders — publish a signed ask / bid / private offer. */
export const POST = route({ auth: "required", transactional: true, rateLimit: RATE_LIMITS.otcCreate }, async ({ req, wallet, ip }) => {
  const input = await body(req, signed);
  return createOrder(otcContext(), { payload: input.payload, signature: input.signature, viewer: wallet!, ...(ip ? { ip } : {}) });
});

/** GET /api/otc/orders — public orderbook (plus the viewer's own private orders with mine=1). */
export const GET = route({ auth: "optional" }, async ({ req, wallet }) => {
  const q = query(
    req,
    z.object({
      mint: zAddress.optional(),
      side: z.enum(["BUY", "SELL"]).optional(),
      maker: zAddress.optional(),
      mine: z.enum(["1", "true"]).optional(),
      status: z.string().optional().transform((s) => (s ? s.split(",").filter((x): x is (typeof ORDER_STATUSES)[number] => (ORDER_STATUSES as readonly string[]).includes(x)) : undefined)),
      limit: zLimit,
      cursor: z.string().max(64).optional(),
    }),
  );
  return listOrders(otcContext(), { ...q, mine: q.mine !== undefined, ...(q.status ? { status: q.status } : {}) }, wallet);
});
