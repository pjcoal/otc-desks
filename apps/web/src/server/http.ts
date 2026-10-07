import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { AppError, isAppError } from "@app/shared";
import { RATE_LIMITS, enforceRateLimit, getKv, getServerConfig, logger, metrics, reportError, type RateLimitRule } from "@app/shared/server";
import { getDb } from "@app/database";
import { currentSession, isAdmin, type Session } from "./session";

type Auth = "none" | "optional" | "required" | "admin";

export interface HandlerCtx<P> {
  req: NextRequest;
  params: P;
  session: Session | null;
  wallet: string | null;
  ip: string | null;
}

interface Options {
  auth?: Auth;
  rateLimit?: RateLimitRule;
  /** Builds or submits a transaction: refused on mainnet unless ALLOW_MAINNET=true. */
  transactional?: boolean;
}

/** JSON with bigint support. */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  return new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

/**
 * Client IP for rate limiting. X-Forwarded-For entries left of our trusted proxies are client-
 * controlled, so we take the entry appended by the outermost trusted proxy (read from the right).
 */
export function clientIp(req: NextRequest): string | null {
  const hops = getServerConfig().TRUSTED_PROXY_HOPS;
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (hops > 0 && parts.length > 0) return parts[Math.max(0, parts.length - hops)] ?? null;
  return req.headers.get("x-real-ip") || null;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** CSRF: state-changing requests must come from our own origin (SameSite=Lax cookie + Origin check). */
function checkOrigin(req: NextRequest): void {
  if (!MUTATING.has(req.method)) return;
  const expected = new URL(getServerConfig().APP_URL).origin;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (origin) {
    if (origin !== expected) throw new AppError("CSRF_REJECTED");
  } else if (site && site !== "same-origin") {
    throw new AppError("CSRF_REJECTED");
  } else if (!site) {
    // Non-browser clients must still declare intent explicitly.
    if (req.headers.get("x-requested-with") !== "fetch") throw new AppError("CSRF_REJECTED");
  }
}

export function route<P = Record<string, never>>(opts: Options, handler: (c: HandlerCtx<P>) => Promise<unknown>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    const started = Date.now();
    const ip = clientIp(req);
    try {
      checkOrigin(req);
      const config = getServerConfig();
      if (opts.transactional && !config.transactionsEnabled) throw new AppError("MAINNET_DISABLED");
      const session = opts.auth && opts.auth !== "none" ? await currentSession() : null;
      if ((opts.auth === "required" || opts.auth === "admin") && !session) throw new AppError("UNAUTHENTICATED");
      if (opts.auth === "admin" && !isAdmin(session?.wallet)) throw new AppError("FORBIDDEN");
      const rule = opts.rateLimit ?? (MUTATING.has(req.method) ? RATE_LIMITS.mutate : RATE_LIMITS.read);
      // Limit by wallet AND by IP so neither rotating wallets nor sharing an IP defeats it.
      await enforceRateLimit(getKv(), rule, `ip:${ip ?? "unknown"}`);
      if (session) await enforceRateLimit(getKv(), rule, `w:${session.wallet}`);
      const params = (await ctx.params) ?? ({} as P);
      const result = await handler({ req, params, session, wallet: session?.wallet ?? null, ip });
      metrics.inc(`http.${req.method}.ok`);
      return result instanceof NextResponse ? result : json(result);
    } catch (e) {
      return errorResponse(e, req, Date.now() - started);
    }
  };
}

function errorResponse(e: unknown, req: NextRequest, ms: number): NextResponse {
  if (isAppError(e)) {
    metrics.inc(`http.error.${e.code}`);
    if (e.status >= 500) void logError(e.code, e.message, { path: req.nextUrl.pathname });
    return json(e.toJSON(), { status: e.status });
  }
  if (e instanceof ZodError) {
    return json({ error: { code: "VALIDATION", message: "Some fields are invalid.", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, { status: 400 });
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/RPC HTTP (429|5\d\d)|All RPC endpoints failed|fetch failed|ETIMEDOUT|ECONNRESET/.test(message)) {
    metrics.inc("http.error.RPC_UNAVAILABLE");
    return json({ error: { code: "RPC_UNAVAILABLE", message: "Solana RPC is temporarily unavailable. Please retry shortly." } }, { status: 503 });
  }
  reportError(e, { path: req.nextUrl.pathname, method: req.method, ms });
  void logError("INTERNAL", e instanceof Error ? e.message : String(e), { path: req.nextUrl.pathname });
  return json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } }, { status: 500 });
}

async function logError(code: string, message: string, context: Record<string, unknown>) {
  try {
    await getDb().errorLog.create({ data: { source: "web", code, message: message.slice(0, 2000), context: context as object } });
  } catch (err) {
    logger.warn({ err }, "failed to persist error log");
  }
}

const MAX_JSON_BYTES = 64 * 1024;

export async function body<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new AppError("VALIDATION", "Request body too large.");
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", "Request body must be JSON.");
  }
  return schema.parse(raw);
}

export function query<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}
