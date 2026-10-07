import { z } from "zod";
import { AppError } from "@app/shared";
import { getDb } from "@app/database";
import { transitionOrder } from "@app/otc/server";
import { body, route } from "@/server/http";

/**
 * POST /api/admin/orders/:id/invalidate — moderation (e.g. a scam mint). Stops our app from settling
 * the order; it cannot move assets, alter signed terms, or revoke a transaction users already signed.
 * Refused while a settlement is live. Always audited with the admin's wallet and reason.
 */
export const POST = route<{ id: string }>({ auth: "admin" }, async ({ req, params, wallet, ip }) => {
  const { reason } = await body(req, z.object({ reason: z.string().trim().min(5).max(500) }));
  const db = getDb();
  const live = await db.otcSettlement.findFirst({ where: { orderId: params.id, activeLock: { not: null } } });
  if (live) throw new AppError("SETTLEMENT_IN_PROGRESS", "A settlement is live; wait for it to resolve.");
  await db.$transaction(async (tx) => {
    await transitionOrder(tx, { orderId: params.id, to: "INVALIDATED", from: ["OPEN", "NEGOTIATING", "ACCEPTED", "PARTIALLY_FILLED"], actor: `admin:${wallet}`, reason: `Admin: ${reason}`, extra: { activeAcceptanceId: null, acceptanceExpiresAt: null } });
    await tx.auditEvent.create({ data: { actor: `admin:${wallet}`, action: "admin.order.invalidate", entityType: "OtcOrder", entityId: params.id, data: { reason }, ip } });
  });
  return { ok: true };
});
