import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request nonce CSP (scripts must carry the nonce; 'strict-dynamic' lets Next's own chunks load),
 * referral capture (?ref=CODE → first-party cookie, attributed at sign-in), and optional region
 * blocking driven by BLOCKED_REGIONS + the CDN's country header.
 */
const REF_RE = /^[A-Za-z0-9]{4,16}$/;

function origin(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

export function proxy(request: NextRequest) {
  const blocked = (process.env.BLOCKED_REGIONS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const country = (request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry") ?? "").toUpperCase();
  const path = request.nextUrl.pathname;
  if (blocked.length > 0 && country && blocked.includes(country) && !path.startsWith("/terms") && !path.startsWith("/risk") && !path.startsWith("/privacy") && !path.startsWith("/restricted")) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: { code: "REGION_BLOCKED", message: "This service is not available in your region." } }, { status: 451 });
    return NextResponse.redirect(new URL("/restricted", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const rpc = origin(process.env.PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
  const rpcWs = rpc.replace(/^http/, "ws");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${rpc} ${rpcWs}${isDev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  const ref = request.nextUrl.searchParams.get("ref");
  if (ref && REF_RE.test(ref) && !request.cookies.get("ref")) {
    response.cookies.set("ref", ref, { httpOnly: true, sameSite: "lax", secure: !isDev, maxAge: 60 * 60 * 24 * 30, path: "/" });
  }
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
