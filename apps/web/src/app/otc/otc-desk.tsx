"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { relativeTime } from "@app/shared";
import type { NegotiationView, OrderView } from "@app/otc";
import { api } from "@/lib/api";
import { price, timeLeft } from "@/lib/format";
import type { OtcTradeRow } from "@/lib/types";
import { useAuth } from "@/components/providers/auth";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { buttonClass } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Empty } from "@/components/ui/skeleton";
import { DemoBadge, SideBadge, StatusPill } from "@/components/ui/status";
import { TokenAvatar } from "@/components/ui/token-avatar";

export function OtcDesk() {
  const { wallet } = useAuth();
  const orders = useQuery({ queryKey: ["orders", "all"], queryFn: () => api<{ items: OrderView[] }>("/api/otc/orders?limit=50"), refetchInterval: 20_000 });
  const trades = useQuery({ queryKey: ["otc-trades", "all"], queryFn: () => api<{ trades: OtcTradeRow[] }>("/api/otc/trades?limit=20") });
  const mine = useQuery({ queryKey: ["negotiations", wallet], enabled: !!wallet, queryFn: () => api<{ negotiations: NegotiationView[] }>("/api/otc/negotiations") });
  const myOrders = useQuery({ queryKey: ["orders", "mine", wallet], enabled: !!wallet, queryFn: () => api<{ items: OrderView[] }>("/api/otc/orders?mine=1&limit=50") });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-display text-[30px] leading-none">OTC desk</h1>
          <p className="mt-2 max-w-prose text-muted">Block offers for Pump tokens, settled wallet-to-wallet in one atomic Solana transaction. No escrow: assets stay in each wallet until both parties sign.</p>
        </div>
        <Link href="/otc/create" className={buttonClass({ size: "lg" })}>New offer</Link>
      </div>

      {wallet && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Your negotiations" />
            {!mine.data?.negotiations.length ? (
              <Empty title="No negotiations yet">Counteroffers and private deals you're part of show up here.</Empty>
            ) : (
              <ul className="m-2 divide-y divide-line bg-ink bevel-in">
                {mine.data.negotiations.map((n) => {
                  const latest = n.revisions[n.revisions.length - 1]!;
                  return (
                    <li key={n.id}>
                      <Link href={`/deal/${latest.publicId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                        <TokenAvatar src={latest.token.imageUrl} symbol={latest.token.symbol} size={28} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate"><Tokens raw={latest.tokenAmountRaw} decimals={latest.token.decimals} symbol={latest.token.symbol} /> for <Sol lamports={latest.quoteAmountRaw} digits={3} /></p>
                          <p className="text-[13px] text-muted">Revision {latest.revision}, {latest.makerWallet === wallet ? "your move is done" : "your move"}</p>
                        </div>
                        <StatusPill status={latest.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Your orders" />
            {!myOrders.data?.items.length ? (
              <Empty title="You have no open orders" action={<Link href="/otc/create" className={buttonClass({ variant: "outline", size: "sm" })}>Create an offer</Link>} />
            ) : (
              <ul className="m-2 divide-y divide-line bg-ink bevel-in">
                {myOrders.data.items.map((o) => (
                  <li key={o.id}>
                    <Link href={`/deal/${o.publicId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                      <SideBadge side={o.side} />
                      <span className="min-w-0 flex-1 truncate"><Tokens raw={o.remainingAmountRaw} decimals={o.token.decimals} symbol={o.token.symbol} /> for <Sol lamports={o.quoteAmountRaw} digits={3} /></span>
                      <StatusPill status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <Panel>
        <PanelHeader title="Open public offers" />
        {!orders.data?.items.length ? (
          <Empty title="No public offers right now" action={<Link href="/otc/create" className={buttonClass({ variant: "outline", size: "sm" })}>Post the first one</Link>}>Asks and bids across all Pump tokens appear here.</Empty>
        ) : (
          <div className="m-2 overflow-x-auto bg-ink bevel-in">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="text-left text-[13px] text-text">
                <tr>
                  <th className="px-4 py-2 bg-panel font-normal bevel-out">Token</th>
                  <th className="px-2 py-2 bg-panel font-normal bevel-out">Side</th>
                  <th className="px-2 py-2 bg-panel font-normal bevel-out">Quantity</th>
                  <th className="px-2 py-2 bg-panel font-normal bevel-out">Total</th>
                  <th className="px-2 py-2 bg-panel font-normal bevel-out">Price / token</th>
                  <th className="px-2 py-2 bg-panel font-normal bevel-out">Maker</th>
                  <th className="px-4 py-2 text-right bg-panel font-normal bevel-out">Expires</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.id} className="border-b border-line/60 hover:bg-hover">
                    <td className="px-4 py-2.5">
                      <Link href={`/deal/${o.publicId}`} className="flex items-center gap-2 hover:underline">
                        <TokenAvatar src={o.token.imageUrl} symbol={o.token.symbol} size={22} />
                        {o.token.symbol} <DemoBadge show={o.isDemo} />
                      </Link>
                    </td>
                    <td className="px-2 py-2.5"><SideBadge side={o.side} /></td>
                    <td className="px-2 py-2.5"><Tokens raw={o.remainingAmountRaw} decimals={o.token.decimals} /></td>
                    <td className="px-2 py-2.5"><Sol lamports={o.quoteAmountRaw} digits={3} /></td>
                    <td className="num px-2 py-2.5">{price(o.priceSolPerToken)}</td>
                    <td className="px-2 py-2.5"><Address value={o.makerWallet} profile /></td>
                    <td className="px-4 py-2.5 text-right text-muted">{timeLeft(o.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Recent block trades" />
        {!trades.data?.trades.length ? (
          <Empty title="No settled OTC trades yet">Every settlement links to a receipt that anyone can verify on Solana.</Empty>
        ) : (
          <ul className="m-2 divide-y divide-line bg-ink bevel-in">
            {trades.data.trades.map((t) => (
              <li key={t.txSignature}>
                <Link href={`/trade/${t.txSignature}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover">
                  <span className="font-medium">{t.symbol}</span>
                  <Tokens raw={t.tokenAmountRaw} decimals={t.decimals} />
                  <Sol lamports={t.grossQuoteLamports} digits={3} />
                  <DemoBadge show={t.isDemo} />
                  <span className="ml-auto text-[13px] text-muted">{t.blockTime ? relativeTime(t.blockTime) : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
