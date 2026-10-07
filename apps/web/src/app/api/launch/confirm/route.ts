import { z } from "zod";
import { AppError } from "@app/shared";
import { dec, getDb } from "@app/database";
import { getRpc } from "@app/solana/server";
import { eventsFromTransaction } from "@app/pump";
import { route, body } from "@/server/http";
import { registry } from "@/server/context";
import { zAddress, zSignature } from "@/server/schemas";

/**
 * POST /api/launch/confirm — record a launch only after verifying it ON CHAIN: the transaction must be
 * confirmed, successful, and emit a Pump CreateEvent for this mint by the signed-in wallet.
 */
export const POST = route({ auth: "required" }, async ({ req, wallet }) => {
  const input = await body(req, z.object({ signature: zSignature, mint: zAddress }));
  const tx = await getRpc().freshConnection.getTransaction(input.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) throw new AppError("TX_NOT_FOUND", "Launch transaction not found yet. It may still be confirming.");
  if (tx.meta?.err) throw new AppError("TX_VERIFICATION_FAILED", "The launch transaction failed on chain.");
  const events = eventsFromTransaction(tx);
  const create = events.find((e) => e.kind === "CREATE" && e.mint === input.mint);
  if (!create || create.kind !== "CREATE") throw new AppError("TX_VERIFICATION_FAILED", "No Pump create event for this mint in that transaction.");
  if (create.user !== wallet) throw new AppError("FORBIDDEN", "This launch was signed by a different wallet.");
  const buy = events.find((e) => e.kind === "TRADE" && e.mint === input.mint && e.isBuy && e.user === wallet);

  await registry().refreshMarket(input.mint);
  const db = getDb();
  await db.token.update({ where: { mint: input.mint }, data: { launchedViaPlatform: true, createSignature: input.signature, createdSlot: BigInt(tx.slot), createdAt: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(), creator: create.creator } });
  await db.launch.upsert({
    where: { signature: input.signature },
    create: { signature: input.signature, mint: input.mint, creator: create.creator, slot: BigInt(tx.slot), initialBuyLamports: dec(buy && buy.kind === "TRADE" ? buy.solAmount : 0n), initialBuyTokens: dec(buy && buy.kind === "TRADE" ? buy.tokenAmount : 0n) },
    update: {},
  });
  await db.transactionRecord.upsert({ where: { signature: input.signature }, create: { signature: input.signature, kind: "LAUNCH", wallet: wallet!, mint: input.mint, status: "CONFIRMED", slot: BigInt(tx.slot), summary: { name: create.name, symbol: create.symbol } }, update: { status: "CONFIRMED" } });
  await db.auditEvent.create({ data: { actor: wallet!, action: "token.launched", entityType: "Token", entityId: input.mint, data: { signature: input.signature } } });
  return { mint: input.mint, signature: input.signature };
});
