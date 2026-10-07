import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import { AppError } from "@app/shared";
import { getDb } from "@app/database";
import { decodeTransactionError, fromBase64, sha256Hex } from "@app/solana";
import { wasPrepared } from "@/server/tx";
import { getRpc } from "@app/solana/server";
import { PUMP_PROGRAM_ERRORS } from "@app/pump";
import { getServerConfig } from "@app/shared/server";
import { route, body } from "@/server/http";

/**
 * POST /api/tx/submit — relay a transaction the user's wallet already signed (used when the wallet
 * does not broadcast itself). The relay cannot alter it: any change would invalidate the signature.
 */
export const POST = route({ auth: "required", transactional: "launch" }, async ({ req, wallet }) => {
  const input = await body(req, z.object({ signedTransactionBase64: z.string().max(4096), kind: z.enum(["BUY", "SELL", "LAUNCH"]), mint: z.string().max(64).optional() }));
  if (input.kind !== "LAUNCH" && !getServerConfig().transactionsEnabled) throw new AppError("MAINNET_DISABLED");
  const tx = VersionedTransaction.deserialize(fromBase64(input.signedTransactionBase64));
  const payer = tx.message.staticAccountKeys[0]?.toBase58();
  if (payer !== wallet) throw new AppError("FORBIDDEN", "Only your own transactions can be relayed.");
  // Only relay transactions this server prepared for this wallet in the last few minutes.
  if (!(await wasPrepared(sha256Hex(tx.message.serialize()), wallet!))) throw new AppError("TX_CHANGED", "This transaction was not prepared here or has expired. Please review and sign again.");
  const sig = bs58.encode(tx.signatures[0]!);
  try {
    await getRpc().freshConnection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  } catch (e) {
    const err = e as { transactionError?: unknown; logs?: string[]; message?: string };
    const decoded = decodeTransactionError((err.transactionError as never) ?? "SimulationFailed", err.logs ?? null, { instructionPrograms: tx.message.compiledInstructions.map((c) => tx.message.staticAccountKeys[c.programIdIndex]!), programErrors: PUMP_PROGRAM_ERRORS });
    throw new AppError(decoded?.code ?? "SIMULATION_FAILED", decoded?.message ?? err.message);
  }
  await getDb().transactionRecord.upsert({ where: { signature: sig }, create: { signature: sig, kind: input.kind, wallet: wallet!, mint: input.mint ?? null, status: "SUBMITTED", summary: {} }, update: {} });
  return { signature: sig };
});
