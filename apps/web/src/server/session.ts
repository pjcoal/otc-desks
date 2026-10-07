import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@app/database";
import { generateSessionToken, hashSessionToken } from "@app/auth/server";
import { getServerConfig } from "@app/shared/server";

export const SESSION_COOKIE = "otc_session";

export interface Session {
  id: string;
  wallet: string;
  expiresAt: Date;
}

/** Resolve the session from the HttpOnly cookie. The wallet address is only ever taken from here. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  const tokenHash = hashSessionToken(token, getServerConfig().SESSION_SECRET);
  const s = await getDb().session.findUnique({ where: { tokenHash } });
  if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now()) return null;
  return { id: s.id, wallet: s.walletAddress, expiresAt: s.expiresAt };
}

export async function createSession(wallet: string, meta: { ip: string | null; userAgent: string | null }): Promise<Session> {
  const c = getServerConfig();
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + c.SESSION_TTL_SECONDS * 1000);
  const s = await getDb().session.create({ data: { tokenHash: hashSessionToken(token, c.SESSION_SECRET), walletAddress: wallet, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 256) ?? null } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: c.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
  return { id: s.id, wallet, expiresAt };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDb().session.updateMany({ where: { tokenHash: hashSessionToken(token, getServerConfig().SESSION_SECRET), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

export function isAdmin(wallet: string | null | undefined): boolean {
  return !!wallet && getServerConfig().ADMIN_WALLETS.includes(wallet);
}
