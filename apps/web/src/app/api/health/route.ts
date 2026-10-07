import { getDb } from "@app/database";
import { getKv, metrics } from "@app/shared/server";
import { getRpc } from "@app/solana/server";
import { route } from "@/server/http";

export const GET = route({}, async () => {
  const [db, kv, slot] = await Promise.all([
    getDb().$queryRaw`SELECT 1`.then(() => true, () => false),
    getKv().ping(),
    getRpc().connection.getSlot().then((s) => s, () => null),
  ]);
  const checkpoint = await getDb().indexerCheckpoint.findMany().catch(() => []);
  return { ok: db && kv && slot !== null, db, kv: { ok: kv, kind: getKv().kind }, rpc: { slot, endpoints: getRpc().health() }, indexer: checkpoint.map((c) => ({ stream: c.stream, lastSlot: c.lastSlot.toString(), updatedAt: c.updatedAt, lagSlots: slot !== null ? slot - Number(c.lastSlot) : null })), metrics: metrics.snapshot() };
});
