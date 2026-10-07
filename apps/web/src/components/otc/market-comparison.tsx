"use client";
import { useQuery } from "@tanstack/react-query";
import { D } from "@app/shared";
import { api } from "@/lib/api";
import { bps, pct, price } from "@/lib/format";
import { Sol } from "@/components/ui/amount";
import { Row } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

interface Compare {
  quotedAt: string;
  slot: number;
  venue: string;
  spotPriceSolPerToken: string;
  otc: { priceSolPerToken: string; premiumDiscountPct: string | null; grossLamports: string; platformFeeLamports: string; sellerNetLamports: string; buyerPaysLamports: string; feeBps: number; feeMode: string };
  market: null | { expectedOutput: string; minOutput: string; maxInput: string; priceImpactBps: number; protocolFeeLamports: string; creatorFeeLamports: string; lpFeeLamports: string; executionPriceSolPerToken: string; route: string };
  note: string | null;
}

/**
 * "Sell through Pump now" vs "this OTC deal". Every figure is an estimate from live chain state at the
 * time shown; neither column is a promise of what will execute.
 */
export function MarketComparison({ mint, side, tokenAmountRaw, quoteLamports }: { mint: string; side: "BUY" | "SELL"; tokenAmountRaw: bigint; quoteLamports: bigint; symbol?: string }) {
  const enabled = tokenAmountRaw > 0n && quoteLamports > 0n;
  const { data, isLoading, error } = useQuery({
    queryKey: ["compare", mint, side, tokenAmountRaw.toString(), quoteLamports.toString()],
    enabled,
    refetchInterval: 20_000,
    queryFn: () => api<Compare>(`/api/otc/compare?mint=${mint}&side=${side}&tokenAmount=${tokenAmountRaw}&quoteLamports=${quoteLamports}`),
  });
  if (!enabled) return null;
  if (isLoading || !data) return <Skeleton className="h-48" />;
  if (error) return <p className="text-sell">{(error as Error).message}</p>;
  const m = data.market;
  const fees = m ? BigInt(m.protocolFeeLamports) + BigInt(m.creatorFeeLamports) + BigInt(m.lpFeeLamports) : 0n;
  const selling = side === "SELL";
  const diff = m && selling ? BigInt(data.otc.sellerNetLamports) - BigInt(m.expectedOutput) : null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[var(--radius-control)] border border-line p-3">
          <p className="mb-2 font-medium">{selling ? "Sell into Pump now" : "Buy on Pump now"}</p>
          {m ? (
            <dl className="text-[13px]">
              {selling ? (
                <>
                  <Row label="Expected SOL"><Sol lamports={m.expectedOutput} /></Row>
                  <Row label="Minimum (with slippage)"><Sol lamports={m.minOutput} /></Row>
                </>
              ) : (
                <Row label="SOL spent"><Sol lamports={quoteLamports} /></Row>
              )}
              <Row label="Price impact"><span className={m.priceImpactBps > 500 ? "text-warn" : undefined}>{bps(m.priceImpactBps)}</span></Row>
              <Row label="Protocol + creator fees"><Sol lamports={fees} digits={5} /></Row>
              <Row label="Avg. price / token">{price(m.executionPriceSolPerToken)}</Row>
              <Row label="Route"><span className="text-[12px] text-muted">{m.route}</span></Row>
            </dl>
          ) : (
            <p className="text-[13px] text-muted">{data.note ?? "No market quote available."}</p>
          )}
        </div>
        <div className="rounded-[var(--radius-control)] border border-glacier/40 bg-glacier-dim/20 p-3">
          <p className="mb-2 font-medium">This OTC deal</p>
          <dl className="text-[13px]">
            <Row label="Agreed price"><Sol lamports={data.otc.grossLamports} /></Row>
            <Row label={`Platform fee (${bps(data.otc.feeBps)}, ${data.otc.feeMode === "SELLER_PAYS" ? "seller pays" : data.otc.feeMode === "BUYER_PAYS" ? "buyer pays" : "split"})`}><Sol lamports={data.otc.platformFeeLamports} digits={5} /></Row>
            {selling ? <Row label="Seller receives"><Sol lamports={data.otc.sellerNetLamports} /></Row> : <Row label="Buyer pays"><Sol lamports={data.otc.buyerPaysLamports} /></Row>}
            <Row label="Price / token">{price(data.otc.priceSolPerToken)}</Row>
            <Row label="vs Pump market">
              <span className={data.otc.premiumDiscountPct && new D(data.otc.premiumDiscountPct).lt(0) ? "text-sell" : "text-buy"}>{pct(data.otc.premiumDiscountPct)}</span>
            </Row>
            <Row label="Price impact">None (off-market)</Row>
          </dl>
        </div>
      </div>
      {selling && m && diff !== null && (
        <p className="text-[13px]">
          Estimated difference for the seller:{" "}
          <span className={diff >= 0n ? "text-buy" : "text-sell"}>
            {diff >= 0n ? "+" : "−"}
            <Sol lamports={diff >= 0n ? diff : -diff} />
          </span>{" "}
          {diff >= 0n ? "more than selling into the market now" : "less than selling into the market now"}.
        </p>
      )}
      <p className="text-[12px] text-faint">
        Estimates from slot {data.slot} at {new Date(data.quotedAt).toLocaleTimeString()}. Market prices move constantly; the OTC side settles only if a counterparty accepts and both wallets sign. This is not a recommendation.
      </p>
    </div>
  );
}
