import { AppError } from "@app/shared";
import type { Tx } from "@app/database";
import { canTransition, fromStatusesFor, type OrderStatus } from "../state";

/** Anything that can write audit rows: the client itself or an interactive transaction. */
export type AuditWriter = Pick<Tx, "auditEvent">;

export async function audit(
  tx: AuditWriter,
  e: { actor: string; action: string; entityType: string; entityId: string; fromStatus?: string | null; toStatus?: string | null; data?: unknown; ip?: string | null },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actor: e.actor,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      data: e.data === undefined ? undefined : JSON.parse(JSON.stringify(e.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
      ip: e.ip ?? null,
    },
  });
}

/**
 * Atomic, race-safe status transition: `UPDATE ... WHERE id = ? AND status IN (allowed sources)`.
 * If another request changed the order first, zero rows match and we raise a conflict instead of
 * overwriting. Every transition is audited.
 */
export async function transitionOrder(
  tx: Tx,
  args: { orderId: string; to: OrderStatus; from?: OrderStatus[]; actor: string; reason?: string | null; chainProof?: boolean; data?: Record<string, unknown>; extra?: Record<string, unknown> },
): Promise<OrderStatus> {
  const current = await tx.otcOrder.findUnique({ where: { id: args.orderId }, select: { status: true } });
  if (!current) throw new AppError("NOT_FOUND", "Order not found.");
  const from = current.status as OrderStatus;
  const allowed = (args.from ?? fromStatusesFor(args.to, { chainProof: args.chainProof ?? false })).filter((s) =>
    canTransition(s, args.to, { chainProof: args.chainProof ?? false }),
  );
  if (!allowed.includes(from)) throw conflictFor(from);
  const res = await tx.otcOrder.updateMany({
    where: { id: args.orderId, status: { in: allowed } },
    data: { status: args.to, statusReason: args.reason ?? null, ...(args.extra ?? {}) },
  });
  if (res.count !== 1) throw new AppError("SETTLEMENT_IN_PROGRESS", "The order changed concurrently. Please refresh.");
  await audit(tx, { actor: args.actor, action: "order.transition", entityType: "OtcOrder", entityId: args.orderId, fromStatus: from, toStatus: args.to, data: { reason: args.reason, ...args.data } });
  return from;
}

export function conflictFor(status: OrderStatus): AppError {
  switch (status) {
    case "FILLED":
      return new AppError("ORDER_FILLED");
    case "CANCELLED":
      return new AppError("ORDER_CANCELLED");
    case "EXPIRED":
      return new AppError("ORDER_EXPIRED");
    case "INVALIDATED":
    case "FAILED":
      return new AppError("ORDER_INVALIDATED");
    case "NEGOTIATING":
      return new AppError("ORDER_NOT_LATEST_REVISION");
    case "ACCEPTED":
    case "SETTLEMENT_READY":
      return new AppError("SETTLEMENT_IN_PROGRESS");
    default:
      return new AppError("ORDER_NOT_ACCEPTABLE");
  }
}
