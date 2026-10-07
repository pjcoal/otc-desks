import "server-only";
import { VersionedTransaction, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { AppError } from "@app/shared";
import { getKv, getServerConfig } from "@app/shared/server";
import { compileV0, computeBudgetInstructions, decodeTransactionError, estimateNetworkFeeLamports, toBase64 } from "@app/solana";
import { getRpc } from "@app/solana/server";
import { PUMP_PROGRAM_ERRORS } from "@app/pump";

export interface PreparedTx {
  transactionBase64: string;
  messageHash: string;
  blockhash: string;
  lastValidBlockHeight: number;
  networkFeeLamports: string;
  unitsConsumed: number | null;
}

/**
 * Compile an unsigned v0 transaction for `payer`, simulate it (unless disabled for non-mainnet dev),
 * and surface a decoded reason instead of a generic failure.
 */
/** Remember what we prepared so /api/tx/submit only relays our own, user-signed transactions. */
async function rememberPrepared(messageHash: string, wallet: string): Promise<void> {
  await getKv().set(`prepared-tx:${messageHash}`, wallet, 300);
}

export async function wasPrepared(messageHash: string, wallet: string): Promise<boolean> {
  return (await getKv().get(`prepared-tx:${messageHash}`)) === wallet;
}

export async function prepareUserTransaction(payer: PublicKey, instructions: TransactionInstruction[], computeUnits: number, opts: { signers?: number; skipSimulation?: boolean } = {}): Promise<PreparedTx> {
  const c = getServerConfig();
  const connection = getRpc().freshConnection;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const ixs = [...computeBudgetInstructions(computeUnits, c.PRIORITY_FEE_MICROLAMPORTS), ...instructions];
  const built = compileV0(payer, ixs, blockhash, lastValidBlockHeight);
  let unitsConsumed: number | null = null;
  if (c.SIMULATE_TRANSACTIONS && !opts.skipSimulation) {
    const sim = await connection.simulateTransaction(new VersionedTransaction(built.message), { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
    unitsConsumed = sim.value.unitsConsumed ?? null;
    const decoded = decodeTransactionError(sim.value.err, sim.value.logs, {
      instructionPrograms: built.message.compiledInstructions.map((ci) => built.message.staticAccountKeys[ci.programIdIndex]!),
      programErrors: PUMP_PROGRAM_ERRORS,
      tokenInsufficientFunds: "SELLER_INSUFFICIENT_TOKENS",
      systemInsufficientFunds: "BUYER_INSUFFICIENT_SOL",
    });
    if (decoded) throw new AppError(decoded.code, decoded.message, { logs: sim.value.logs?.slice(-10), programError: decoded.programError });
  }
  await rememberPrepared(built.hash, payer.toBase58());
  return {
    transactionBase64: toBase64(new VersionedTransaction(built.message).serialize()),
    messageHash: built.hash,
    blockhash,
    lastValidBlockHeight,
    networkFeeLamports: estimateNetworkFeeLamports(opts.signers ?? 1, computeUnits, c.PRIORITY_FEE_MICROLAMPORTS).toString(),
    unitsConsumed,
  };
}

export function serializeQuote<T extends object>(q: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(q).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
}
