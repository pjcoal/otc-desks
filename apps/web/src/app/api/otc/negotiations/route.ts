import { getDb } from "@app/database";
import { negotiationView } from "@app/otc/server";
import { route } from "@/server/http";

/** GET /api/otc/negotiations — the signed-in wallet's own negotiation threads. */
export const GET = route({ auth: "required" }, async ({ wallet }) => {
  const db = getDb();
  const threads = await db.otcNegotiation.findMany({ where: { OR: [{ makerWallet: wallet! }, { counterpartyWallet: wallet! }] }, orderBy: { updatedAt: "desc" }, take: 50 });
  const out = [];
  for (const n of threads) {
    const revs = await db.otcOrder.findMany({ where: { OR: [{ id: n.rootOrderId }, { rootNegotiationId: n.id }] }, include: { token: true, parentOrder: { select: { orderHash: true } } }, orderBy: { revision: "asc" } });
    out.push(negotiationView(n, revs));
  }
  return { negotiations: out };
});
