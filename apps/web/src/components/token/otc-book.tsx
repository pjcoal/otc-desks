"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { D } from "@app/shared";
import type { OrderView } from "@app/otc";
import { api } from "@/lib/api";
import { pct, price, timeLeft } from "@/lib/format";
import type { OtcTradeRow } from "@/lib/types";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { DemoBadge } from "@/components/ui/status";
import { Empty } from "@/components/ui/skeleton";
import { buttonClass } from "@/components/ui/button";
import { relativeTime } from "@app/shared";

function premium(p: string, ref: string | null): string | null {
  if (!ref) return null;
  const m = new D(ref);
  if (m.isZero()) return null;
  return new D(p).sub(m).div(m).mul(100).toFixed(2);
}

function OrderTable({ mint, orders, side, marketPrice, symbol }: { mint: string; orders: OrderView[]; side: "BUY" | "SELL"; marketPrice: string | null; symbol: string }) {
  if (!orders.length)
    return (
      <Empty title={side === "SELL" ? "No sell offers yet" : "No bids yet"} action={<Link href={`/otc/create?mint=${mint}&side=${side}`} className={buttonClass({ variant: "outline", size: "sm" })}>{side === "SELL" ? "Post an ask" : "Place a bid"}</Link>}>
        {side === "SELL" ? "Holders can offer size here without selling into the curve." : "Show sellers what you would pay for a block."}
      </Empty>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead className="text-left text-[12px] text-faint">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">Quantity</th>
            <th className="px-2 py-2 font-medium">Price / token</th>
            <th className="px-2 py-2 font-medium">Total</th>
            <th className="px-2 py-2 font-medium">vs market</th>
            <th className="px-2 py-2 font-medium">Maker</th>
            <th className="px-2 py-2 font-medium">Expires</th>
            <th className="px-4 py-2 font-medium text-right">Posted</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const prem = premium(o.priceSolPerToken, marketPrice);
            return (
              <tr key={o.id} className="border-b border-line/60 hover:bg-hover/60">
                <td className="px-4 py-2.5">
                  <Link href={`/deal/${o.publicId}`} className="hover:underline">
                    <Tokens raw={o.remainingAmountRaw} decimals={o.token.decimals} symbol={symbol} />
                  </Link>
                  {o.allowPartialFill && <span className="ml-1.5 text-[11px] text-faint">partial ok</span>} <DemoBadge show={o.isDemo} />
                </td>
                <td className="num px-2 py-2.5">{price(o.priceSolPerToken)}</td>
                <td className="px-2 py-2.5"><Sol lamports={o.quoteAmountRaw} digits={3} /></td>
                <td className={`num px-2 py-2.5 ${prem === null ? "text-faint" : new D(prem).lt(0) ? "text-sell" : "text-buy"}`}>{prem === null ? "—" : pct(prem)}</td>
                <td className="px-2 py-2.5"><Address value={o.makerWallet} profile /></td>
                <td className="px-2 py-2.5 text-muted">{timeLeft(o.expiresAt)}</td>
                <td className="px-4 py-2.5 text-right text-muted">{relativeTime(o.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function OtcBook({ mint, symbol, marketPrice, marketAt }: { mint: string; symbol: string; marketPrice: string | null; marketAt: string | null }) {
  const asks = useQuery({ queryKey: ["orders", mint, "SELL"], queryFn: () => api<{ items: OrderView[] }>(`/api/otc/orders?mint=${mint}&side=SELL&limit=50`) });
  const bids = useQuery({ queryKey: ["orders", mint, "BUY"], queryFn: () => api<{ items: OrderView[] }>(`/api/otc/orders?mint=${mint}&side=BUY&limit=50`) });
  const trades = useQuery({ queryKey: ["otc-trades", mint], queryFn: () => api<{ otc: OtcTradeRow[] }>(`/api/tokens/${mint}/trades`) });
  const sortedAsks = [...(asks.data?.items ?? [])].sort((a, b) => new D(a.priceSolPerToken).cmp(new D(b.priceSolPerToken)));
  const sortedBids = [...(bids.data?.items ?? [])].sort((a, b) => new D(b.priceSolPerToken).cmp(new D(a.priceSolPerToken)));
  return (
    <div className="space-y-6">
      <p className="px-4 pt-4 text-[12px] text-faint">
        Premium / discount compares each OTC price with the Pump market price of {price(marketPrice)} SOL{marketAt ? ` at ${new Date(marketAt).toLocaleTimeString()}` : ""}. A reference price is not a price you could execute size at.
      </p>
      <section>
        <div className="flex items-center justify-between px-4 pb-2">
          <h3 className="font-semibold text-sell">Sell offers</h3>
          <Link href={`/otc/create?mint=${mint}&side=SELL`} className={buttonClass({ variant: "outline", size: "sm" })}>Make OTC offer</Link>
        </div>
        <OrderTable mint={mint} orders={sortedAsks} side="SELL" marketPrice={marketPrice} symbol={symbol} />
      </section>
      <section>
        <div className="flex items-center justify-between px-4 pb-2">
          <h3 className="font-semibold text-buy">Buy offers</h3>
          <Link href={`/otc/create?mint=${mint}&side=BUY`} className={buttonClass({ variant: "outline", size: "sm" })}>Place OTC bid</Link>
        </div>
        <OrderTable mint={mint} orders={sortedBids} side="BUY" marketPrice={marketPrice} symbol={symbol} />
      </section>
      <section className="pb-2">
        <h3 className="px-4 pb-2 font-semibold">Recent block trades</h3>
        {!trades.data?.otc.length ? (
          <Empty title="No OTC trades settled yet">Settled block trades appear here with links to their on-chain receipts.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-left text-[12px] text-faint">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Quantity</th>
                  <th className="px-2 py-2 font-medium">Total</th>
                  <th className="px-2 py-2 font-medium">Seller</th>
                  <th className="px-2 py-2 font-medium">Buyer</th>
                  <th className="px-4 py-2 text-right font-medium">Settled</th>
                </tr>
              </thead>
              <tbody>
                {trades.data.otc.map((t) => (
                  <tr key={t.txSignature} className="border-b border-line/60">
                    <td className="px-4 py-2.5"><Tokens raw={t.tokenAmountRaw} decimals={t.decimals} symbol={symbol} /></td>
                    <td className="px-2 py-2.5"><Sol lamports={t.grossQuoteLamports} digits={3} /></td>
                    <td className="px-2 py-2.5"><Address value={t.seller} profile /></td>
                    <td className="px-2 py-2.5"><Address value={t.buyer} profile /></td>
                    <td className="px-4 py-2.5 text-right">
                      {t.txSignature && <Link href={`/trade/${t.txSignature}`} className="text-glacier hover:underline">{t.blockTime ? relativeTime(t.blockTime) : "receipt"}</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
