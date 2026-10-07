import { cn } from "@/lib/cn";

/** Token images are untrusted remote content: plain <img>, no referrer, fallback to initials. */
export function TokenAvatar({ src, symbol, size = 32, className }: { src: string | null | undefined; symbol: string; size?: number; className?: string }) {
  const safe = src && /^https:\/\//.test(src) ? src : src && src.startsWith("http://localhost") ? src : null;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden bg-raised text-[12px] font-semibold text-muted bevel-in p-0.5", className)} style={{ width: size, height: size }}>
      {safe ? (
        <img src={safe} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" decoding="async" className="size-full object-cover [image-rendering:pixelated]" />
      ) : (
        (symbol || "?").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
