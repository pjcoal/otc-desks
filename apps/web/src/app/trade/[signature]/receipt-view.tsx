"use client";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX } from "lucide-react";
import Link from "next/link";
import { D } from "@app/shared";
import type { ReceiptView as Receipt } from "@app/otc";
import { api } from "@/lib/api";
import { pct, price } from "@/lib/format";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Panel, Row } from "@/components/ui/panel";
import { ErrorNote, Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status";

export function ReceiptView({ signature }: { signature: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["receipt", signature], queryFn: () => api<Receipt>(`/api/receipts/${signature}`), refetchInterval: (q) => (q.state.data?.status === "finalized" ? false : 8000) });
  if (isLoading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (error) return <ErrorNote error={error} />;
  if (!data || data.status === "not_found")
    return (
      <Panel className="mx-auto max-w-2xl p-6">
        <h1 className="title-display text-[32px]">Not found yet</h1>
        <p className="mt-2 text-muted">This transaction isn't visible on chain yet. It may still be confirming; this page refreshes automatically.</p>
      </Panel>
    );
  const d = data.token?.decimals ?? 6;
  const sym = data.token?.symbol || "tokens";
  return (
    <Panel className="mx-auto max-w-2xl p-6">
      <div className="flex items-center gap-2">
        {data.verified ? <CircleCheck className="size-5 text-buy" /> : <CircleX className="size-5 text-sell" />}
        <span className={data.verified ? "text-buy" : "text-sell"}>{data.verified ? "Verified from on-chain data" : "Could not be verified as an OTC settlement"}</span>
        <span className="ml-auto"><StatusPill status={data.status === "finalized" ? "FINALIZED" : data.status === "failed" ? "FAILED" : "CONFIRMED"} /></span>
      </div>
      <h1 className="title-display mt-4 text-[38px] leading-tight">
        <Tokens raw={data.tokenAmountRaw} decimals={d} symbol={sym} /> for <Sol lamports={data.buyerPaidLamports} />
      </h1>
      {data.verificationErrors.length > 0 && <ErrorNote className="mt-3" error={data.verificationErrors.join(" ")} />}
      <dl className="mt-5 text-[14px]">
        <Row label="Token">{data.token ? <Link href={`/token/${data.token.mint}`} className="hover:underline">{data.token.name || sym}</Link> : "—"} {data.token && <Address value={data.token.mint} />}</Row>
        <Row label="Seller">{data.seller && <Address value={data.seller} profile />}</Row>
        <Row label="Buyer">{data.buyer && <Address value={data.buyer} profile />}</Row>
        <Row label="Tokens sent"><Tokens raw={data.tokenAmountRaw} decimals={d} /></Row>
        {data.netTokenReceivedRaw && data.netTokenReceivedRaw !== data.tokenAmountRaw && <Row label="Tokens received (after Token-2022 transfer fee)"><Tokens raw={data.netTokenReceivedRaw} decimals={d} /></Row>}
        <Row label="SOL paid by buyer"><Sol lamports={data.buyerPaidLamports} /></Row>
        <Row label="SOL received by seller"><Sol lamports={data.sellerReceivedLamports} /></Row>
        <Row label="Platform fee"><Sol lamports={data.platformFeeLamports} digits={6} /></Row>
        {data.referralFeeLamports && data.referralFeeLamports !== "0" && <Row label="Referral share of fee"><Sol lamports={data.referralFeeLamports} digits={6} /></Row>}
        <Row label="Price per token">{price(data.priceSolPerToken)} SOL</Row>
        <Row label="Pump reference price" hint="Estimate captured when settlement was built">{price(data.refPriceSolPerToken)} SOL</Row>
        <Row label="Premium / discount"><span className={data.premiumDiscountPct && new D(data.premiumDiscountPct).lt(0) ? "text-sell" : "text-buy"}>{pct(data.premiumDiscountPct)}</span></Row>
        <Row label="Time">{data.blockTime ? new Date(data.blockTime).toLocaleString() : "—"}</Row>
        <Row label="Slot">{data.slot ?? "—"}</Row>
        <Row label="Transaction"><Address value={signature} kind="tx" chars={8} /></Row>
        {data.orderHash && <Row label="Order hash (in memo)"><span className="font-mono text-[12px] text-muted">{data.orderHash.slice(0, 24)}…</span></Row>}
      </dl>
      <div className="mt-5 rounded-[var(--radius-control)] bg-raised px-4 py-3 text-[13px] text-muted">
        <p className="font-medium text-text">Verify it yourself</p>
        <p className="mt-1">Open the transaction in an explorer. You'll see one transaction, signed by both wallets, containing a token transfer from the seller and SOL transfers from the buyer, plus a memo <span className="font-mono">otc-settlement:v1:&lt;order hash&gt;</span> linking it to the signed order.</p>
      </div>
    </Panel>
  );
}
