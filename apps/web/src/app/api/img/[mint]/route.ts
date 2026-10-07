import { NextResponse } from "next/server";
import { getDb } from "@app/database";
import { isBase58PublicKey } from "@app/shared";
import { getServerConfig } from "@app/shared/server";
import { imageFetchUrl, safeFetchBytes } from "@app/market";
import { route } from "@/server/http";
import { thumbnail } from "@/server/images";

const SIZES = new Set([64, 128, 256]);
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const miss = () => new NextResponse(null, { status: 404, headers: { "cache-control": "public, max-age=300, s-maxage=600" } });

/**
 * GET /api/img/<mint>?w=64 — a token's image, fetched server-side (SSRF-hardened, IPFS gateway
 * fallback), re-encoded as a square WebP and cached by the CDN. Only images of tokens we know are
 * served, so this is not an open proxy; visitors' browsers never contact third-party image hosts.
 */
export const GET = route<{ mint: string }>({}, async ({ req, params }) => {
  const w = Number(req.nextUrl.searchParams.get("w") ?? 128);
  if (!isBase58PublicKey(params.mint) || !SIZES.has(w)) return miss();
  const token = await getDb().token.findFirst({ where: { mint: params.mint, isDemo: false }, select: { imageUrl: true } });
  if (!token?.imageUrl) return miss();
  const c = getServerConfig();
  let out: Buffer | null = null;
  try {
    const { body } = await safeFetchBytes(imageFetchUrl(token.imageUrl), { ipfs: c.IPFS_GATEWAY_URL, ipfsFallbacks: c.IPFS_FALLBACK_GATEWAYS }, { accept: "image/*", maxBytes: MAX_SOURCE_BYTES });
    out = await thumbnail(body, w);
  } catch {
    out = null;
  }
  if (!out) return miss();
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
});
