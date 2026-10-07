import { z } from "zod";

export const zAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "invalid Solana address");
export const zSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/, "invalid signature");
export const zU64 = z
  .string()
  .regex(/^(0|[1-9]\d{0,19})$/, "expected an integer string")
  .refine((s) => !/^(0|[1-9]\d{0,19})$/.test(s) || BigInt(s) <= 18_446_744_073_709_551_615n, "exceeds u64");
export const zBps = z.coerce.number().int().min(0).max(5000);
export const zSlippageBps = z.coerce.number().int().min(1).max(5000);
export const zLimit = z.coerce.number().int().min(1).max(100).default(25);
