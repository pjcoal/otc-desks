"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { isBase58PublicKey, relativeTime } from "@app/shared";
import type { OrderView } from "@app/otc";
import { api } from "@/lib/api";
import type { OtcTradeRow } from "@/lib/types";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Empty, ErrorNote, Skeleton } from "@/components/ui/skeleton";
import { SideBadge, StatusPill, VenueBadge } from "@/components/ui/status";
import { TokenAvatar } from "@/components/ui/token-avatar";

interface Profile {
  address: string;
  createdTokens: Array<{ mint: string; symbol: string; name: string; imageUrl: string | null; venue: string; createdAt: string; marketCapLamports: string | null }>;
  publicOrders: OrderView[];
  otcTrades: OtcTradeRow[];
  activity: Array<{ signature: string; mint: string; side: "BUY" | "SELL"; solAmount: string; tokenAmount: string; venue: string; blockTime: string }>;
}

export function WalletProfile({ address }: { address: string }) {
  const valid = isBase58PublicKey(address);
  const { data, isLoading, error } = useQuery({ queryKey: ["profile", address], enabled: valid, queryFn: () => api<Profile>(`/api/wallets/${address}`) });
  if (!valid) return <ErrorNote error="Not a valid wallet address." />;
  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="title-display text-[40px] leading-none">Wallet</h1>
        <p className="mt-2"><Address value={address} full /></p>
        <p className="mt-1 text-[12px] text-faint">Public on-chain activity only. Private offers and negotiations are never shown here.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Tokens created" />
          {!data.createdTokens.length ? <Empty title="No tokens created" /> : (
            <ul className="divide-y divide-line">
              {data.createdTokens.map((t) => (
                <li key={t.mint}>
                  <Link href={`/token/${t.mint}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover/60">
                    <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={24} />
                    <span className="font-medium">{t.symbol}</span>
                    <span className="truncate text-muted">{t.name}</span>
                    <span className="ml-auto"><VenueBadge venue={t.venue} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Public OTC orders" />
          {!data.publicOrders.length ? <Empty title="No open public orders" /> : (
            <ul className="divide-y divide-line">
              {data.publicOrders.map((o) => (
                <li key={o.id}>
                  <Link href={`/deal/${o.publicId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover/60">
                    <SideBadge side={o.side} />
                    <span className="min-w-0 flex-1 truncate">{o.token.symbol} <Tokens raw={o.remainingAmountRaw} decimals={o.token.decimals} /> for <Sol lamports={o.quoteAmountRaw} digits={3} /></span>
                    <StatusPill status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Completed public OTC trades" />
        {!data.otcTrades.length ? <Empty title="No public OTC trades" /> : (
          <ul className="divide-y divide-line">
            {data.otcTrades.map((t) => (
              <li key={t.txSignature}>
                <Link href={`/trade/${t.txSignature}`} className="flex flex-wrap items-center gap-x-4 px-4 py-3 hover:bg-hover/60">
                  <span className={t.seller === address ? "text-sell" : "text-buy"}>{t.seller === address ? "Sold" : "Bought"}</span>
                  <Tokens raw={t.tokenAmountRaw} decimals={t.decimals} symbol={t.symbol} />
                  <Sol lamports={t.grossQuoteLamports} digits={3} />
                  <span className="ml-auto text-[12px] text-muted">{t.blockTime ? relativeTime(t.blockTime) : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel>
        <PanelHeader title="Recent Pump activity (indexed)" />
        {!data.activity.length ? <Empty title="No indexed trades" /> : (
          <ul className="divide-y divide-line">
            {data.activity.map((a) => (
              <li key={a.signature} className="flex flex-wrap items-center gap-x-4 px-4 py-2.5 text-[13px]">
                <span className={a.side === "BUY" ? "text-buy" : "text-sell"}>{a.side === "BUY" ? "Buy" : "Sell"}</span>
                <Link href={`/token/${a.mint}`} className="hover:underline"><Address value={a.mint} /></Link>
                <Sol lamports={a.solAmount} digits={3} />
                <span className="ml-auto text-muted">{relativeTime(a.blockTime)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
