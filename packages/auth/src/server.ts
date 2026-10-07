import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bs58 from "bs58";

export * from "./index";

/** 128-bit random nonce, base58. */
export function generateNonce(): string {
  return bs58.encode(randomBytes(16));
}

/** 256-bit random session token, base64url. Only the HMAC is stored server-side. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Unguessable public identifier (e.g. /deal/[id]); 144 bits. */
export function generatePublicId(): string {
  return randomBytes(18).toString("base64url");
}
