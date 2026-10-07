"use client";
import { VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { fromBase64, toBase64 } from "@app/solana";
import { api, post } from "./api";

export class UserRejected extends Error {}

function rethrow(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|cancel|denied|declined/i.test(msg)) throw new UserRejected("You declined the request in your wallet.");
  throw e instanceof Error ? e : new Error(msg);
}

/** Sign a UTF-8 message (orders, acceptances, cancellations). Returns a base58 signature. */
export async function signText(wallet: WalletContextState, text: string): Promise<string> {
  if (!wallet.signMessage) throw new Error("Your wallet does not support message signing.");
  try {
    return bs58.encode(await wallet.signMessage(new TextEncoder().encode(text)));
  } catch (e) {
    rethrow(e);
  }
}

/** Sign WITHOUT broadcasting (OTC partial signatures). Returns the signed transaction, base64. */
export async function signOnly(wallet: WalletContextState, txBase64: string): Promise<string> {
  if (!wallet.signTransaction) throw new Error("Your wallet does not support signing transactions without sending them.");
  const tx = VersionedTransaction.deserialize(fromBase64(txBase64));
  try {
    const signed = await wallet.signTransaction(tx);
    return toBase64(signed.serialize());
  } catch (e) {
    rethrow(e);
  }
}

/**
 * Sign and broadcast a single-party transaction the user has already reviewed and we have verified.
 * Extra local signers (the client-generated mint keypair) sign first, in the browser only.
 */
export async function signAndSend(wallet: WalletContextState, connection: Connection, txBase64: string, opts: { extraSigners?: Keypair[]; kind: "BUY" | "SELL" | "LAUNCH"; mint?: string }): Promise<string> {
  const tx = VersionedTransaction.deserialize(fromBase64(txBase64));
  if (opts.extraSigners?.length) tx.sign(opts.extraSigners);
  let signature: string;
  try {
    if (wallet.signTransaction) {
      const signed = await wallet.signTransaction(tx);
      ({ signature } = await post<{ signature: string }>("/api/tx/submit", { signedTransactionBase64: toBase64(signed.serialize()), kind: opts.kind, ...(opts.mint ? { mint: opts.mint } : {}) }));
    } else {
      signature = await wallet.sendTransaction(tx, connection, { skipPreflight: false, preflightCommitment: "confirmed" });
    }
  } catch (e) {
    rethrow(e);
  }
  return signature;
}

/** Poll our API (which reads the chain) until the signature is confirmed, failed, or times out. */
export async function waitForConfirmation(signature: string, timeoutMs = 90_000): Promise<"confirmed" | "finalized" | "failed" | "timeout"> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await api<{ state: string }>(`/api/tx/${signature}`).catch(() => ({ state: "not_found" }));
    if (s.state === "confirmed" || s.state === "finalized" || s.state === "failed") return s.state;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "timeout";
}
