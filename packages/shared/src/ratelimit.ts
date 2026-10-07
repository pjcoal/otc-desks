import { AppError } from "./errors";
import type { KeyValueStore } from "./kv";

export interface RateLimitRule {
  /** Logical bucket name, e.g. "otc:create". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  authNonce: { name: "auth:nonce", limit: 20, windowSeconds: 60 },
  authVerify: { name: "auth:verify", limit: 10, windowSeconds: 60 },
  search: { name: "search", limit: 60, windowSeconds: 60 },
  quote: { name: "quote", limit: 120, windowSeconds: 60 },
  mutate: { name: "mutate", limit: 30, windowSeconds: 60 },
  otcCreate: { name: "otc:create", limit: 20, windowSeconds: 300 },
  upload: { name: "upload", limit: 10, windowSeconds: 600 },
  settlement: { name: "settlement", limit: 30, windowSeconds: 60 },
  read: { name: "read", limit: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window limiter keyed by rule + identity. Identity is the authenticated wallet when known,
 * otherwise the client IP — so rotating wallets does not bypass IP limits on anonymous endpoints,
 * and NAT-shared IPs do not starve authenticated users.
 */
export async function enforceRateLimit(kv: KeyValueStore, rule: RateLimitRule, identity: string): Promise<void> {
  const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
  const count = await kv.incrWindow(`rl:${rule.name}:${identity}:${window}`, rule.windowSeconds);
  if (count > rule.limit) throw new AppError("RATE_LIMITED");
}
