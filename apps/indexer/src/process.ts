import type { VersionedTransactionResponse } from "@solana/web3.js";
import { SOL_DECIMALS, decimalToDbString, unitPrice } from "@app/shared";
import { dec, Prisma, type Db } from "@app/database";
import { eventsFromTransaction, isCanonicalPumpPool, type PumpDecodedEvent } from "@app/pump";

export interface IndexResult {
  events: number;
  trades: number;
  mintsTouched: Set<string>;
  newMints: Set<string>;
}

export interface IndexOptions {
  /** Only index activity for these mints (tracked mode). null = firehose. */
  tracked: Set<string> | null;
  /** Resolve a PumpSwap pool to its base mint (cached lookups / RPC). */
  poolToMint: (pool: string) => Promise<string | null>;
}

const toDate = (unix: number | null | undefined) => (unix ? new Date(unix * 1000) : new Date());

/**
 * Persist every Pump / PumpSwap event in one confirmed transaction. Idempotent: rows are keyed by
 * (signature, eventIndex), so replays, backfill overlap and duplicate websocket deliveries are no-ops.
 */
export async function indexTransaction(db: Db, signature: string, tx: VersionedTransactionResponse, opts: IndexOptions): Promise<IndexResult> {
  const result: IndexResult = { events: 0, trades: 0, mintsTouched: new Set(), newMints: new Set() };
  if (!tx.meta || tx.meta.err) return result;
  const events = eventsFromTransaction(tx);
  if (events.length === 0) return result;
  const slot = BigInt(tx.slot);
  const blockTime = toDate(tx.blockTime);

  const resolved: Array<{ e: PumpDecodedEvent; mint: string | null; index: number }> = [];
  for (const [index, e] of events.entries()) {
    let mint: string | null = null;
    if ("mint" in e) mint = e.mint;
    else if (e.kind === "CREATE_POOL") mint = e.baseMint;
    else if (e.kind === "AMM_BUY" || e.kind === "AMM_SELL") mint = await opts.poolToMint(e.pool);
    if (opts.tracked && (!mint || !opts.tracked.has(mint)) && e.kind !== "CREATE") continue;
    resolved.push({ e, mint, index });
  }
  if (resolved.length === 0) return result;

  const json = (e: PumpDecodedEvent) => JSON.parse(JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;
  const created = await db.pumpEvent.createMany({
    data: resolved.map(({ e, mint, index }) => ({ signature, eventIndex: index, slot, blockTime, program: e.program, kind: e.kind, mint, data: json(e) })),
    skipDuplicates: true,
  });
  result.events = created.count;

  const decimalsCache = new Map<string, number>();
  const decimalsOf = async (mint: string) => {
    if (!decimalsCache.has(mint)) decimalsCache.set(mint, (await db.token.findUnique({ where: { mint }, select: { decimals: true } }))?.decimals ?? 6);
    return decimalsCache.get(mint)!;
  };

  for (const { e, mint, index } of resolved) {
    if (!mint) continue;
    result.mintsTouched.add(mint);
    switch (e.kind) {
      case "CREATE": {
        if (opts.tracked && !opts.tracked.has(mint)) break;
        const exists = await db.token.findUnique({ where: { mint }, select: { mint: true } });
        if (!exists) {
          await db.token.create({
            data: { mint, tokenProgram: e.tokenProgram, decimals: 6, name: e.name.slice(0, 64), symbol: e.symbol.slice(0, 16), creator: e.creator, quoteMint: e.quoteMint, isMayhemMode: e.isMayhemMode, isHolderReward: e.isHolderReward, venue: "PUMP_BONDING_CURVE", createSignature: signature, createdSlot: slot, createdAt: blockTime },
          }).catch(() => undefined);
          result.newMints.add(mint);
        } else {
          await db.token.update({ where: { mint }, data: { createSignature: signature, createdSlot: slot, createdAt: blockTime, creator: e.creator } });
        }
        break;
      }
      case "TRADE": {
        if (e.quoteMint !== "SOL" || e.tokenAmount === 0n) break;
        const decimals = await decimalsOf(mint);
        const p = unitPrice(e.solAmount, SOL_DECIMALS, e.tokenAmount, decimals);
        const t = await db.trade.createMany({
          data: [{ signature, eventIndex: index, mint, venue: "PUMP_BONDING_CURVE", side: e.isBuy ? "BUY" : "SELL", trader: e.user, solAmount: dec(e.solAmount), tokenAmount: dec(e.tokenAmount), priceSolPerToken: new Prisma.Decimal(decimalToDbString(p)), protocolFee: dec(e.fee), creatorFee: dec(e.creatorFee), slot, blockTime }],
          skipDuplicates: true,
        });
        result.trades += t.count;
        await db.token.updateMany({ where: { mint }, data: { lastTradeAt: blockTime } });
        break;
      }
      case "AMM_BUY":
      case "AMM_SELL": {
        if (e.baseAmount === 0n) break;
        const decimals = await decimalsOf(mint);
        const p = unitPrice(e.quoteAmount, SOL_DECIMALS, e.baseAmount, decimals);
        const t = await db.trade.createMany({
          data: [{ signature, eventIndex: index, mint, venue: "PUMPSWAP", side: e.kind === "AMM_BUY" ? "BUY" : "SELL", trader: e.user, solAmount: dec(e.quoteAmount), tokenAmount: dec(e.baseAmount), priceSolPerToken: new Prisma.Decimal(decimalToDbString(p)), protocolFee: dec(e.protocolFee), creatorFee: dec(e.coinCreatorFee), slot, blockTime }],
          skipDuplicates: true,
        });
        result.trades += t.count;
        await db.token.updateMany({ where: { mint }, data: { lastTradeAt: blockTime } });
        break;
      }
      case "COMPLETE":
        await db.token.updateMany({ where: { mint }, data: { complete: true } });
        break;
      case "CREATE_POOL":
        // Only the canonical pool created by migration counts as graduation.
        if (isCanonicalPumpPool(e.pool, mint)) {
          await db.token.updateMany({ where: { mint }, data: { venue: "PUMPSWAP", poolAddress: e.pool, complete: true, graduatedAt: blockTime } });
        }
        break;
    }
  }
  return result;
}
