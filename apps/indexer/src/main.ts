/**
 * Indexer worker.
 *
 *   Solana RPC websocket ──► signature queue ──► getTransaction ──► parser ──► Postgres
 *                                                                        └──► Redis pub/sub ──► SSE
 *
 * • Resumes from IndexerCheckpoint (last processed signature per program) and back-fills the gap.
 * • Uses `confirmed` data for fast UI; a finality pass promotes rows to FINALIZED and deletes rows
 *   whose transaction disappeared (dropped fork) — the only reorg case confirmed data can see.
 * • Every write is idempotent, so restarts, overlapping backfill and duplicate notifications are safe.
 * • Also runs OTC maintenance: order expiry, acceptance-hold release, settlement reconciliation.
 */
import { PublicKey, type Logs } from "@solana/web3.js";
import { getDb } from "@app/database";
import { CHANNELS, getKv, getServerConfig, logger as root, metrics, reportError, setErrorReporter } from "@app/shared/server";
import { getRpc } from "@app/solana/server";
import { TokenRegistry } from "@app/market";
import { runMaintenance, Web3ChainGateway, type OtcContext } from "@app/otc/server";
import { decodePoolBaseMint, isCanonicalPumpPool, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "@app/pump";
import { indexTransaction } from "./process";

process.env.SERVICE_NAME ??= "indexer";
const log = root.child({ service: "indexer" });
const config = getServerConfig();
const db = getDb();
const kv = getKv();
const rpc = getRpc();
const conn = rpc.connection;
const registry = new TokenRegistry(db, conn, config, kv);

if (config.ERROR_WEBHOOK_URL) {
  const url = config.ERROR_WEBHOOK_URL;
  setErrorReporter((err, ctx) => void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service: "indexer", error: String(err), ctx }) }).catch(() => {}));
}

const PROGRAMS = [
  { stream: "pump", id: PUMP_PROGRAM_ID },
  { stream: "pump-amm", id: PUMP_AMM_PROGRAM_ID },
] as const;
const BACKFILL_LIMIT = Number(process.env.INDEXER_BACKFILL_LIMIT ?? 500);
const CONCURRENCY = Number(process.env.INDEXER_CONCURRENCY ?? 3);

// ── pool → mint resolution (cached) ──
const poolCache = new Map<string, string | null>();
async function poolToMint(pool: string): Promise<string | null> {
  if (poolCache.has(pool)) return poolCache.get(pool)!;
  const known = await db.token.findFirst({ where: { poolAddress: pool }, select: { mint: true } });
  let mint = known?.mint ?? null;
  if (!mint) {
    const info = await conn.getAccountInfo(new PublicKey(pool)).catch(() => null);
    const base = info ? decodePoolBaseMint(info) : null;
    // Only canonical Pump pools are Pump coins; ignore other PumpSwap pools.
    mint = base && isCanonicalPumpPool(pool, base) ? base : null;
  }
  poolCache.set(pool, mint);
  return mint;
}

// ── tracked set (mainnet "tracked" mode) ──
let tracked: Set<string> | null = null;
async function refreshTracked() {
  if (config.INDEXER_MODE !== "tracked") return;
  const rows = await db.token.findMany({ select: { mint: true } });
  tracked = new Set(rows.map((r) => r.mint));
}

// ── signature queue ──
const queue: Array<{ sig: string; stream: string; slot?: number; attempt: number }> = [];
const MAX_ATTEMPTS = 6;
const queued = new Set<string>();
let active = 0;
const touched = new Set<string>();

function enqueue(sig: string, stream: string, slot?: number, attempt = 0) {
  if (queued.has(sig) && attempt === 0) return;
  queued.add(sig);
  queue.push({ sig, stream, attempt, ...(slot !== undefined ? { slot } : {}) });
  pump();
}

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    active++;
    let retrying = false;
    void processSignature(job.sig, job.stream)
      .catch((e) => {
        metrics.inc("indexer.process_error");
        if (job.attempt + 1 < MAX_ATTEMPTS) {
          // Transient RPC failures (429, timeouts) are retried with exponential backoff + jitter.
          retrying = true;
          const delay = Math.min(60_000, 1000 * 2 ** job.attempt) + Math.floor(Math.random() * 500);
          setTimeout(() => enqueue(job.sig, job.stream, job.slot, job.attempt + 1), delay);
        } else {
          log.error({ err: e instanceof Error ? e.message : e, sig: job.sig }, "giving up on transaction after retries; the next catch-up will revisit it");
          metrics.inc("indexer.gave_up");
        }
      })
      .finally(() => {
        active--;
        if (!retrying) queued.delete(job.sig);
        pump();
      });
  }
}

async function processSignature(sig: string, stream: string) {
  const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) return;
  const r = await indexTransaction(db, sig, tx, { tracked, poolToMint });
  metrics.inc("indexer.tx");
  if (r.events) metrics.inc("indexer.events", r.events);
  for (const m of r.mintsTouched) touched.add(m);
  for (const m of r.newMints) void registry.ensureToken(m).catch(() => undefined);
  // Advance the checkpoint monotonically (concurrent/out-of-order completions never move it backwards).
  await db.$executeRaw`INSERT INTO "IndexerCheckpoint" (stream, "lastSlot", "lastSignature", "updatedAt") VALUES (${stream}, ${BigInt(tx.slot)}, ${sig}, now())
    ON CONFLICT (stream) DO UPDATE SET "lastSlot" = EXCLUDED."lastSlot", "lastSignature" = EXCLUDED."lastSignature", "updatedAt" = now()
    WHERE "IndexerCheckpoint"."lastSlot" <= EXCLUDED."lastSlot"`;
}

/** Backfill everything newer than the checkpoint (bounded), oldest first. */
async function catchUp(stream: string, program: PublicKey) {
  const cp = await db.indexerCheckpoint.findUnique({ where: { stream } });
  const sigs: string[] = [];
  let before: string | undefined;
  while (sigs.length < BACKFILL_LIMIT) {
    const page = await conn.getSignaturesForAddress(program, { limit: Math.min(1000, BACKFILL_LIMIT - sigs.length), ...(before ? { before } : {}), ...(cp?.lastSignature ? { until: cp.lastSignature } : {}) }, "confirmed");
    if (page.length === 0) break;
    sigs.push(...page.filter((p) => !p.err).map((p) => p.signature));
    before = page[page.length - 1]!.signature;
    if (!cp?.lastSignature) break; // fresh start: only the most recent page
  }
  log.info({ stream, count: sigs.length, from: cp?.lastSignature ?? "latest" }, "catch-up");
  for (const s of sigs.reverse()) enqueue(s, stream);
}

// ── live subscription with watchdog ──
const subs = new Map<string, number>();
let lastEventAt = Date.now();
function subscribe() {
  for (const p of PROGRAMS) {
    const prev = subs.get(p.stream);
    if (prev !== undefined) void conn.removeOnLogsListener(prev).catch(() => {});
    const id = conn.onLogs(
      p.id,
      (l: Logs, ctx) => {
        lastEventAt = Date.now();
        if (l.err) return;
        enqueue(l.signature, p.stream, ctx.slot);
      },
      "confirmed",
    );
    subs.set(p.stream, id);
  }
  log.info({ ws: config.SOLANA_WS_URL ?? "derived from RPC URL" }, "subscribed to Pump program logs");
}

// ── finality / fork handling ──
async function finalityPass() {
  const finalized = await conn.getSlot("finalized");
  await db.pumpEvent.updateMany({ where: { commitment: "CONFIRMED", slot: { lte: BigInt(finalized) } }, data: { commitment: "FINALIZED" } });
  await db.trade.updateMany({ where: { commitment: "CONFIRMED", slot: { lte: BigInt(finalized) } }, data: { commitment: "FINALIZED" } });
  // Rows still "confirmed" well past finality whose signature is unknown were on a dropped fork.
  const stale = await db.pumpEvent.findMany({ where: { commitment: "CONFIRMED", slot: { lt: BigInt(finalized - 150) } }, select: { signature: true }, distinct: ["signature"], take: 100 });
  if (stale.length) {
    const { value } = await conn.getSignatureStatuses(stale.map((s) => s.signature), { searchTransactionHistory: true });
    const dropped = stale.filter((_, i) => !value[i]).map((s) => s.signature);
    if (dropped.length) {
      await db.trade.deleteMany({ where: { signature: { in: dropped } } });
      await db.pumpEvent.deleteMany({ where: { signature: { in: dropped } } });
      log.warn({ dropped: dropped.length }, "removed rows from dropped forks");
      metrics.inc("indexer.dropped_fork_rows", dropped.length);
    }
  }
}

/** Refresh market snapshots for mints that traded, then push live updates. */
async function flushTouched() {
  const mints = [...touched].slice(0, 25);
  for (const m of mints) {
    touched.delete(m);
    try {
      if (!tracked || tracked.has(m)) await registry.refreshMarket(m);
      await kv.publish(CHANNELS.market(m), JSON.stringify({ kind: "market", mint: m }));
    } catch (e) {
      log.debug({ mint: m, err: e instanceof Error ? e.message : e }, "market refresh failed");
    }
  }
}

const otcCtx: OtcContext = { db, chain: new Web3ChainGateway(rpc.freshConnection), config, kv, market: registry, now: () => new Date() };

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    fn()
      .catch((e) => reportError(e, { task: name }))
      .finally(() => (running = false));
  }, ms);
}

async function main() {
  log.info({ cluster: config.SOLANA_CLUSTER, mode: config.INDEXER_MODE }, "indexer starting");
  await refreshTracked();
  for (const p of PROGRAMS) await catchUp(p.stream, p.id).catch((e) => reportError(e, { task: "catchUp", stream: p.stream }));
  subscribe();
  every(15_000, "otc-maintenance", async () => {
    const r = await runMaintenance(otcCtx);
    if (r.expired || r.released) log.info(r, "otc maintenance");
  });
  every(5_000, "flush-touched", flushTouched);
  every(30_000, "finality", finalityPass);
  every(60_000, "tracked", refreshTracked);
  every(3_600_000, "housekeeping", async () => {
    const day = new Date(Date.now() - 86_400_000);
    const n = await db.nonce.deleteMany({ where: { expiresAt: { lt: day } } });
    const s = await db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: day } }, { revokedAt: { lt: day } }] } });
    if (n.count || s.count) log.info({ nonces: n.count, sessions: s.count }, "housekeeping");
  });
  every(30_000, "watchdog", async () => {
    if (Date.now() - lastEventAt > 120_000) {
      log.warn("no log notifications for 120s; resubscribing and catching up");
      subscribe();
      for (const p of PROGRAMS) await catchUp(p.stream, p.id);
      lastEventAt = Date.now();
    }
  });
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("unhandledRejection", (e) => reportError(e, { kind: "unhandledRejection" }));
void main();
