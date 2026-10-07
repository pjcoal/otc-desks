import { getDb } from "@app/database";
import { getKv, metrics } from "@app/shared/server";
import { getRpc } from "@app/solana/server";
import { route } from "@/server/http";

/** GET /api/admin/overview — read-only operations dashboard data. Admins cannot sign, move funds, or edit signed economics. */
export const GET = route({ auth: "admin" }, async ({ wallet }) => {
  const db = getDb();
  const now = new Date();
  const day = new Date(Date.now() - 86_400_000);
  const [users, activeSessions, launches, ordersByStatus, settlements, volume, fees, failed, errors, audit, checkpoints, slot] = await Promise.all([
    db.user.count(),
    db.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    db.launch.count(),
    db.otcOrder.groupBy({ by: ["status"], _count: { _all: true } }),
    db.otcSettlement.groupBy({ by: ["status"], _count: { _all: true } }),
    db.otcSettlement.aggregate({ where: { status: { in: ["CONFIRMED", "FINALIZED"] } }, _sum: { grossQuoteLamports: true }, _count: true }),
    db.platformFee.aggregate({ _sum: { amountLamports: true }, _count: true }),
    db.otcSettlement.findMany({ where: { status: { in: ["FAILED", "EXPIRED"] }, updatedAt: { gte: day } }, orderBy: { updatedAt: "desc" }, take: 25 }),
    db.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    db.indexerCheckpoint.findMany(),
    getRpc().connection.getSlot().catch(() => null),
  ]);
  // Record admin access at most once per 10 minutes per admin (the page polls).
  if (await getKv().setNx(`audit:admin-view:${wallet}`, "1", 600)) {
    await db.auditEvent.create({ data: { actor: `admin:${wallet}`, action: "admin.viewed_overview", entityType: "Admin", entityId: "overview" } });
  }
  return {
    users,
    activeSessions,
    launches,
    ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all])),
    settlementsByStatus: Object.fromEntries(settlements.map((o) => [o.status, o._count._all])),
    otcVolumeLamports: volume._sum.grossQuoteLamports?.toFixed(0) ?? "0",
    otcTradeCount: volume._count,
    platformFeesLamports: fees._sum.amountLamports?.toFixed(0) ?? "0",
    failedSettlements: failed.map((f) => ({ id: f.id, orderId: f.orderId, status: f.status, reason: f.failureReason, updatedAt: f.updatedAt })),
    recentErrors: errors,
    recentAudit: audit,
    rpc: { slot, endpoints: getRpc().health() },
    kv: { kind: getKv().kind, ok: await getKv().ping() },
    indexer: checkpoints.map((c) => ({ stream: c.stream, lastSlot: c.lastSlot.toString(), updatedAt: c.updatedAt, lagSlots: slot ? slot - Number(c.lastSlot) : null })),
    metrics: metrics.snapshot(),
  };
});
