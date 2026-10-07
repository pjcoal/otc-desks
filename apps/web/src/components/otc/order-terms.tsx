"use client";
import { ShieldCheck, ShieldX } from "lucide-react";
import type { OrderView } from "@app/otc";
import { useConfig } from "@/components/providers/config";
import { orderSignatureValid } from "@/lib/otc-client";
import { bps, price, timeLeft } from "@/lib/format";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Row } from "@/components/ui/panel";
import { SideBadge, StatusPill } from "@/components/ui/status";

export function OrderTerms({ order }: { order: OrderView }) {
  const cfg = useConfig();
  const valid = orderSignatureValid(cfg, order);
  const sym = order.token.symbol || "tokens";
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SideBadge side={order.side} />
        <StatusPill status={order.status} />
        {order.revision > 0 && <span className="text-[12px] text-muted">Revision {order.revision}</span>}
        <span className={`ml-auto inline-flex items-center gap-1 text-[12px] ${valid ? "text-buy" : "text-sell"}`} title="Checked in your browser against the order's canonical message">
          {valid ? <ShieldCheck className="size-3.5" /> : <ShieldX className="size-3.5" />}
          {valid ? "Maker signature verified" : "Maker signature does not verify"}
        </span>
      </div>
      <p className="text-[22px] font-medium leading-tight">
        {order.side === "SELL" ? "Selling" : "Buying"} <Tokens raw={order.remainingAmountRaw} decimals={order.token.decimals} symbol={sym} /> for <Sol lamports={order.quoteAmountRaw} digits={4} />
      </p>
      <dl className="mt-3 grid gap-x-8 text-[13px] md:grid-cols-2">
        <Row label="Price per token">{price(order.priceSolPerToken)} SOL</Row>
        <Row label="Token mint"><Address value={order.token.mint} chars={6} /></Row>
        <Row label="Maker"><Address value={order.makerWallet} profile /></Row>
        <Row label="Counterparty">{order.takerWallet ? <Address value={order.takerWallet} profile /> : "Anyone"}</Row>
        <Row label="Partial fills">{order.allowPartialFill ? <>Allowed (min <Tokens raw={order.minimumFillAmountRaw} decimals={order.token.decimals} />)</> : "No, all or nothing"}</Row>
        <Row label="Platform fee">{bps(order.platformFeeBps)} ({order.feeMode === "SELLER_PAYS" ? "seller pays" : order.feeMode === "BUYER_PAYS" ? "buyer pays" : "split"})</Row>
        <Row label="Expires">{new Date(order.expiresAt).toLocaleString()} ({timeLeft(order.expiresAt)})</Row>
        <Row label="Filled"><Tokens raw={order.filledAmountRaw} decimals={order.token.decimals} /></Row>
        {order.refPriceSolPerToken && <Row label="Pump price when posted" hint={order.refPriceAt ? new Date(order.refPriceAt).toLocaleString() : undefined}>{price(order.refPriceSolPerToken)} SOL</Row>}
        <Row label="Order hash"><span className="font-mono text-[11px] text-muted">{order.orderHash.slice(0, 16)}…</span></Row>
      </dl>
      {order.note && <p className="mt-3 rounded-[var(--radius-control)] bg-raised px-3 py-2 text-[13px] text-muted">Note from maker: {order.note}</p>}
      {order.statusReason && <p className="mt-2 text-[12px] text-faint">{order.statusReason}</p>}
    </div>
  );
}
