"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { relativeTime } from "@app/shared";
import { api } from "@/lib/api";
import type { OtcTradeRow, TokenCard } from "@/lib/types";
import { Sol, Tokens } from "@/components/ui/amount";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Empty, Skeleton } from "@/components/ui/skeleton";
import { TokenTable } from "./token-table";

export function LiveMarkets() {
  const { data, isLoading } = useQuery({ queryKey: ["explore", "launched_here"], queryFn: () => api<{ items: TokenCard[] }>("/api/tokens?section=launched_here&limit=8") });
  return (
    <Panel>
      <PanelHeader title="Launched here" action={<Link href="/explore?s=launched_here" className="text-[13px] text-glacier hover:underline">Explore all Pump coins</Link>} />
      {isLoading ? <Skeleton className="m-4 h-40" /> : <TokenTable
          items={data?.items ?? []}
          emptyTitle="No tokens launched here yet"
          emptyBody="Coins created with this site's launcher appear here once their launch is confirmed on chain."
          emptyAction={<Link href="/launch" className={buttonClass({ size: "sm", variant: "primary" })}>Launch a token</Link>}
        />}
    </Panel>
  );
}

export function RecentTrades() {
  const { data } = useQuery({ queryKey: ["otc-trades", "home"], queryFn: () => api<{ trades: OtcTradeRow[] }>("/api/otc/trades?limit=8") });
  return (
    <Panel>
      <PanelHeader title="Recent block trades" action={<Link href="/otc" className="text-[13px] text-muted hover:text-text">OTC desk</Link>} />
      {!data?.trades.length ? (
        <Empty title="No block trades yet">Settled OTC trades show up here with verifiable receipts.</Empty>
      ) : (
        <ul className="m-2 divide-y divide-line bg-ink bevel-in">
          {data.trades.map((t) => (
            <li key={t.txSignature}>
              <Link href={`/trade/${t.txSignature}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover">
                <span className="w-20 font-medium">{t.symbol}</span>
                <Tokens raw={t.tokenAmountRaw} decimals={t.decimals} />
                <Sol lamports={t.grossQuoteLamports} digits={2} />
                <span className="ml-auto text-[13px] text-muted">{t.blockTime ? relativeTime(t.blockTime) : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
