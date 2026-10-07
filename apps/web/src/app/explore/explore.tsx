"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { D, relativeTime } from "@app/shared";
import type { OrderView } from "@app/otc";
import { api } from "@/lib/api";
import { formatUsd, pct, price } from "@/lib/format";
import type { TokenCard } from "@/lib/types";
import { Sol, Tokens } from "@/components/ui/amount";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Empty, ErrorNote, Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { TokenTable } from "@/components/home/token-table";
import { useConfig } from "@/components/providers/config";

/** Sections that list coins from across Pump (filtered); the rest list what happened on this site. */
const FILTERED: ReadonlySet<SectionId> = new Set(["trending", "new", "near_graduation", "recently_graduated"]);

function ListingNote() {
  const { listing } = useConfig();
  if (!listing) return null;
  const age = listing.recentHours % 24 === 0 ? `${listing.recentHours / 24} days` : `${listing.recentHours} hours`;
  return (
    <p className="px-3 pb-2 text-[13px] text-muted">
      Showing coins under {age} old with at least {formatUsd(new D(listing.minMcapUsd))} market cap, and older coins with at least {formatUsd(new D(listing.minVolumeUsd))} of 24h volume. Coins launched here are always shown. Paste a mint into Search to open any coin.
    </p>
  );
}

const SECTIONS = [
  { id: "launched_here", label: "Launched here" },
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "near_graduation", label: "Near graduation" },
  { id: "recently_graduated", label: "Recently graduated" },
  { id: "most_otc", label: "Most OTC activity" },
  { id: "largest_discounts", label: "Largest OTC discounts" },
  { id: "largest_otc_trades", label: "Largest OTC trades" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

type Result =
  | { kind: "tokens"; items: TokenCard[] }
  | { kind: "otc_activity"; items: Array<{ token: TokenCard; orders7d: number }> }
  | { kind: "otc_orders"; items: Array<{ order: OrderView & { token: TokenCard; priceDecimal: string; tokenAmountRaw: string; quoteAmountRaw: string; publicId: string }; discountPct: string }> }
  | { kind: "otc_trades"; items: Array<{ settlement: { txSignature: string; tokenAmountRaw: string; grossQuoteLamports: string; tokenDecimals: number; blockTime: string | null }; token: TokenCard | null }> };

type Sort = "default" | "mcap" | "volume" | "new";

export function Explore() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (SECTIONS.find((s) => s.id === params.get("s"))?.id ?? "trending") as SectionId;
  const [section, setSection] = useState<SectionId>(initial);
  const [sort, setSort] = useState<Sort>("default");
  const [venue, setVenue] = useState<"all" | "curve" | "pumpswap">("all");
  const { data, isLoading, error } = useQuery({ queryKey: ["explore", section], queryFn: () => api<Result>(`/api/tokens?section=${section}&limit=48`), refetchInterval: 30_000 });

  const tokens = useMemo(() => {
    if (data?.kind !== "tokens") return [];
    let items = data.items.filter((t) => venue === "all" || (venue === "curve" ? t.venue === "PUMP_BONDING_CURVE" : t.venue === "PUMPSWAP"));
    const n = (s: string | undefined) => new D(s ?? "0");
    if (sort === "mcap") items = [...items].sort((a, b) => n(b.market?.marketCapLamports).cmp(n(a.market?.marketCapLamports)));
    if (sort === "volume") items = [...items].sort((a, b) => n(b.market?.volume24hUsd ?? undefined).cmp(n(a.market?.volume24hUsd ?? undefined)) || n(b.market?.volume24hLamports).cmp(n(a.market?.volume24hLamports)));
    if (sort === "new") items = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }, [data, sort, venue]);

  return (
    <div className="space-y-5">
      <h1 className="title-display text-[30px] leading-none">Explore</h1>
      <Tabs value={section} onValueChange={(v) => { setSection(v as SectionId); router.replace(`/explore?s=${v}`, { scroll: false }); }}>
        <TabsList>
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>{s.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {data?.kind === "tokens" && (
        <div className="flex flex-wrap gap-3">
          <Segmented value={sort} onChange={setSort} size="sm" options={[{ value: "default", label: "Section order" }, { value: "mcap", label: "Market cap" }, { value: "volume", label: "Volume" }, { value: "new", label: "Newest" }]} />
          <Segmented value={venue} onChange={setVenue} size="sm" options={[{ value: "all", label: "All venues" }, { value: "curve", label: "Bonding curve" }, { value: "pumpswap", label: "PumpSwap" }]} />
        </div>
      )}
      <Panel>
        {isLoading && <Skeleton className="m-4 h-64" />}
        {error && <ErrorNote className="m-4" error={error} />}
        {data?.kind === "tokens" && <TokenTable items={tokens} emptyTitle="Nothing here yet" emptyBody={FILTERED.has(section) ? "No coin meets the listing rules in this section right now. We never pad lists with made-up data." : "This list fills from indexed on-chain activity. We never pad it with made-up data."} />}
        {data?.kind === "tokens" && FILTERED.has(section) && <ListingNote />}
        {data?.kind === "otc_activity" &&
          (data.items.length ? (
            <ul className="m-2 divide-y divide-line bg-ink bevel-in">
              {data.items.map((r) => (
                <li key={r.token.mint}>
                  <Link href={`/token/${r.token.mint}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                    <TokenAvatar src={r.token.imageUrl} symbol={r.token.symbol} size={28} />
                    <span className="font-medium">{r.token.symbol}</span>
                    <span className="text-muted">{r.token.name}</span>
                    <span className="num ml-auto">{r.orders7d} public orders in 7 days</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No OTC activity yet" />
          ))}
        {data?.kind === "otc_orders" &&
          (data.items.length ? (
            <ul className="m-2 divide-y divide-line bg-ink bevel-in">
              {data.items.map(({ order: o, discountPct }) => (
                <li key={o.id}>
                  <Link href={`/deal/${o.publicId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover">
                    <TokenAvatar src={o.token.imageUrl} symbol={o.token.symbol} size={24} />
                    <span className="font-medium">{o.token.symbol}</span>
                    <Tokens raw={o.tokenAmountRaw} decimals={o.token.decimals} />
                    <Sol lamports={o.quoteAmountRaw} digits={3} />
                    <span className="num">{price(o.priceDecimal)}</span>
                    <span className={`num ml-auto ${new D(discountPct).lt(0) ? "text-sell" : "text-buy"}`} title="Versus the Pump price captured when the order was posted (estimate)">{pct(discountPct)} vs market at posting</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No discounted asks right now" />
          ))}
        {data?.kind === "otc_trades" &&
          (data.items.length ? (
            <ul className="m-2 divide-y divide-line bg-ink bevel-in">
              {data.items.map(({ settlement: s, token }) => (
                <li key={s.txSignature}>
                  <Link href={`/trade/${s.txSignature}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover">
                    <span className="font-medium">{token?.symbol ?? "Token"}</span>
                    <Tokens raw={s.tokenAmountRaw} decimals={s.tokenDecimals} />
                    <Sol lamports={s.grossQuoteLamports} digits={2} />
                    <span className="ml-auto text-[13px] text-muted">{s.blockTime ? relativeTime(s.blockTime) : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No settled OTC trades yet" />
          ))}
      </Panel>
    </div>
  );
}
