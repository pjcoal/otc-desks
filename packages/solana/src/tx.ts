import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  ComputeBudgetProgram,
  MessageV0,
  PublicKey,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

/** Isomorphic (browser + node) SHA-256 hex digest. */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export interface BuiltMessage {
  message: MessageV0;
  bytes: Uint8Array;
  hash: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

/** Compile a v0 message without address lookup tables (every account is visible in the message). */
export function compileV0(payer: PublicKey, instructions: TransactionInstruction[], blockhash: string, lastValidBlockHeight: number): BuiltMessage {
  const message = MessageV0.compile({ payerKey: payer, instructions, recentBlockhash: blockhash });
  const bytes = message.serialize();
  return { message, bytes, hash: sha256Hex(bytes), blockhash, lastValidBlockHeight };
}

export function computeBudgetInstructions(units: number, microLamports: number): TransactionInstruction[] {
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units })];
  if (microLamports > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  return ixs;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Network fee estimate: 5000 lamports per signature + priority fee (micro-lamports × CU limit). */
export function estimateNetworkFeeLamports(signatures: number, computeUnits: number, microLamportsPerCu: number): bigint {
  const priority = (BigInt(computeUnits) * BigInt(microLamportsPerCu) + 999_999n) / 1_000_000n;
  return 5000n * BigInt(signatures) + priority;
}

export function transactionFromMessageAndSignatures(message: MessageV0, signatures: Array<string | null>): VersionedTransaction {
  const tx = new VersionedTransaction(message);
  signatures.forEach((s, i) => {
    if (s) tx.signatures[i] = bs58.decode(s);
  });
  return tx;
}

export type SignatureState = "not_found" | "processed" | "confirmed" | "finalized" | "failed";

export async function getSignatureState(connection: Connection, signature: string): Promise<{ state: SignatureState; slot?: number; err?: unknown }> {
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = value[0];
  if (!status) return { state: "not_found" };
  if (status.err) return { state: "failed", slot: status.slot, err: status.err };
  const c = status.confirmationStatus;
  return { state: c === "finalized" ? "finalized" : c === "confirmed" ? "confirmed" : "processed", slot: status.slot };
}

export function isValidPublicKey(value: string): boolean {
  try {
    const pk = new PublicKey(value);
    return pk.toBase58() === value;
  } catch {
    return false;
  }
}
