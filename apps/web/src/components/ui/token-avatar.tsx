"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Short stable hash so the CDN cache key changes when a token's image URL changes. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Token images are untrusted remote content. Remote images load through our image proxy
 * (/api/img/<mint>: re-encoded, CDN-cached, IPFS gateway fallback), so browsers never contact the
 * image host. Same-origin uploads load directly. Anything that fails falls back to initials.
 */
export function TokenAvatar({ mint, src, symbol, size = 32, className }: { mint?: string; src: string | null | undefined; symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  let url: string | null = null;
  if (src && src.startsWith("/")) url = src;
  else if (src && /^https:\/\//.test(src) && mint) url = `/api/img/${mint}?w=${size * 2 <= 64 ? 64 : size * 2 <= 128 ? 128 : 256}&v=${hash(src)}`;
  else if (src && src.startsWith("http://localhost")) url = src;
  const show = url && failed !== url;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden bg-raised text-[12px] font-semibold text-muted bevel-in p-0.5", className)} style={{ width: size, height: size }}>
      {show ? (
        <img src={url!} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(url)} className="size-full object-cover [image-rendering:pixelated]" />
      ) : (
        (symbol || "?").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
