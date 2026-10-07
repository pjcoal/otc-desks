"use client";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isBase58PublicKey } from "@app/shared";
import { api } from "@/lib/api";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { VenueBadge } from "@/components/ui/status";
import { shortAddress } from "@/lib/format";

interface Result {
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  venue: string;
}

export function Search() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const { data, isFetching } = useQuery({ queryKey: ["search", debounced], queryFn: () => api<{ results: Result[] }>(`/api/tokens/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 });

  return (
    <div ref={box} className="relative w-full max-w-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isBase58PublicKey(q.trim())) {
            router.push(`/token/${q.trim()}`);
            setOpen(false);
          } else if (data?.results[0]) router.push(`/token/${data.results[0].mint}`);
        }}
      >
        <label className="flex h-7 items-center gap-2 bg-ink px-2 bevel-in">
          <SearchIcon className="size-4 text-faint" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search name, ticker or mint"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
            aria-label="Search tokens"
            maxLength={64}
          />
        </label>
      </form>
      {open && debounced.length >= 2 && (
        <div className="panel absolute left-0 right-0 top-8 z-40 max-h-96 overflow-y-auto shadow-[4px_4px_0_rgba(0,0,0,0.35)]">
          {isFetching && !data && <p className="px-3 py-2 text-muted">Searching…</p>}
          {data && data.results.length === 0 && <p className="px-3 py-2 text-muted">{isBase58PublicKey(debounced) ? "No Pump token found at that mint on this network." : "No matches."}</p>}
          {data?.results.map((r) => (
            <Link key={r.mint} href={`/token/${r.mint}`} onClick={() => setOpen(false)} className="group flex items-center gap-2.5 px-2.5 py-1.5 hover:bg-select hover:text-white">
              <TokenAvatar src={r.imageUrl} symbol={r.symbol} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.symbol}</span>
                <span className="block truncate text-[13px] text-muted group-hover:text-white/80">
                  {r.name} <span className="font-mono">{shortAddress(r.mint)}</span>
                </span>
              </span>
              <VenueBadge venue={r.venue} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
