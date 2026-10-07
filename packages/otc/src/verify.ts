import { verifyWalletSignature } from "@app/auth";
import { hashPayload } from "./canonical";
import { buildAcceptMessage, buildCancelMessage, buildOrderMessage } from "./messages";
import {
  acceptPayloadSchema,
  cancelPayloadSchema,
  orderPayloadSchema,
  sameDomain,
  type AcceptPayload,
  type CancelPayload,
  type OrderPayload,
  type OtcDomain,
} from "./schema";

export interface VerifiedOrder {
  payload: OrderPayload;
  orderHash: string;
  message: string;
}

export type VerifyResult<T> = { ok: true; value: T } | { ok: false; reason: "SCHEMA" | "DOMAIN" | "SIGNATURE"; detail?: string };

/**
 * Validate an order payload against the schema and our domain, rebuild the exact message bytes the
 * maker's wallet must have signed, and verify the ed25519 signature against `makerWallet`.
 * The client-supplied message text is never trusted — only the payload and the signature.
 */
export function verifyOrder(input: unknown, signature: string, domain: OtcDomain): VerifyResult<VerifiedOrder> {
  const parsed = orderPayloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "SCHEMA", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const payload = parsed.data;
  if (!sameDomain(payload, domain)) return { ok: false, reason: "DOMAIN" };
  const message = buildOrderMessage(payload);
  if (!verifyWalletSignature(message, signature, payload.makerWallet)) return { ok: false, reason: "SIGNATURE" };
  return { ok: true, value: { payload, orderHash: hashPayload(payload), message } };
}

export function verifyAccept(
  input: unknown,
  signature: string,
  domain: OtcDomain,
  order: Pick<OrderPayload, "tokenMint" | "tokenDecimals" | "side">,
): VerifyResult<{ payload: AcceptPayload; message: string; hash: string }> {
  const parsed = acceptPayloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "SCHEMA", detail: parsed.error.issues.map((i) => i.message).join("; ") };
  if (!sameDomain(parsed.data, domain)) return { ok: false, reason: "DOMAIN" };
  const message = buildAcceptMessage(parsed.data, order);
  if (!verifyWalletSignature(message, signature, parsed.data.acceptor)) return { ok: false, reason: "SIGNATURE" };
  return { ok: true, value: { payload: parsed.data, message, hash: hashPayload(parsed.data) } };
}

export function verifyCancel(input: unknown, signature: string, domain: OtcDomain): VerifyResult<{ payload: CancelPayload; message: string; hash: string }> {
  const parsed = cancelPayloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "SCHEMA", detail: parsed.error.issues.map((i) => i.message).join("; ") };
  if (!sameDomain(parsed.data, domain)) return { ok: false, reason: "DOMAIN" };
  const message = buildCancelMessage(parsed.data);
  if (!verifyWalletSignature(message, signature, parsed.data.maker)) return { ok: false, reason: "SIGNATURE" };
  return { ok: true, value: { payload: parsed.data, message, hash: hashPayload(parsed.data) } };
}

/** Freshness window for accept / cancel signatures (anti-replay together with unique nonces). */
export const ACTION_SIGNATURE_MAX_SKEW_SECONDS = 300;

export function isFresh(signedAt: number, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  return Math.abs(nowSeconds - signedAt) <= ACTION_SIGNATURE_MAX_SKEW_SECONDS;
}
