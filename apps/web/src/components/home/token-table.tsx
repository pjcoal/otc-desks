"use client";
import Link from "next/link";
import { relativeTime } from "@app/shared";
import { bps, price } from "@/lib/format";
import type { TokenCard } from "@/lib/types";
import { Sol } from "@/components/ui/amount";
import { DemoBadge, VenueBadge } from "@/components/ui/status";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { Empty } from "@/components/ui/skeleton";

export function TokenTable({ items, emptyTitle, emptyBody }: { items: TokenCard[]; emptyTitle: string; emptyBody?: string }) {
  if (!items.length) return <Empty title={emptyTitle}>{emptyBody}</Empty>;
  return (
    <div className="m-2 overflow-x-auto bg-ink bevel-in">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead className="text-left text-[13px] text-text">
          <tr>
            <th className="px-4 py-2 bg-panel font-normal bevel-out">Token</th>
            <th className="px-2 py-2 bg-panel font-normal bevel-out">Price</th>
            <th className="px-2 py-2 bg-panel font-normal bevel-out">Market cap</th>
            <th className="px-2 py-2 bg-panel font-normal bevel-out">24h volume</th>
            <th className="px-2 py-2 bg-panel font-normal bevel-out">Curve</th>
            <th className="px-2 py-2 bg-panel font-normal bevel-out">Venue</th>
            <th className="px-4 py-2 text-right bg-panel font-normal bevel-out">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.mint} className="border-b border-line/60 hover:bg-hover">
              <td className="px-4 py-2.5">
                <Link href={`/token/${t.mint}`} className="flex items-center gap-2.5">
                  <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={28} />
                  <span className="min-w-0">
                    <span className="block font-medium">{t.symbol} <DemoBadge show={t.isDemo} /></span>
                    <span className="block max-w-[200px] truncate text-[13px] text-muted">{t.name}</span>
                  </span>
                </Link>
              </td>
              <td className="num px-2 py-2.5">{price(t.market?.priceSolPerToken)}</td>
              <td className="px-2 py-2.5"><Sol lamports={t.market?.marketCapLamports} digits={1} /></td>
              <td className="px-2 py-2.5"><Sol lamports={t.market?.volume24hLamports ?? "0"} digits={2} /></td>
              <td className="num px-2 py-2.5 text-muted">{t.market?.bondingProgressBps !== null && t.market?.bondingProgressBps !== undefined ? bps(t.market.bondingProgressBps) : "—"}</td>
              <td className="px-2 py-2.5"><VenueBadge venue={t.venue} /></td>
              <td className="px-4 py-2.5 text-right text-muted">{relativeTime(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
