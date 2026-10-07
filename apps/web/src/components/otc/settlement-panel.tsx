"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import { fromBase64, toBase64 } from "@app/solana";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { OrderView, SettlementView } from "@app/otc";
import { useConfig } from "@/components/providers/config";
import { useAuth } from "@/components/providers/auth";
import { api, post } from "@/lib/api";
import { checkSettlement } from "@/lib/otc-client";
import { signOnly, UserRejected } from "@/lib/signing";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Row } from "@/components/ui/panel";
import { ErrorNote } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status";
import { toast } from "@/components/ui/toast";

/**
 * The dual-signature handshake, from one party's point of view. Everything shown under "you send /
 * you receive" is read from the decoded transaction itself, after the browser verified it against
 * the maker-signed order.
 */
export function SettlementPanel({ order, settlementId, onChange }: { order: OrderView; settlementId: string | null; onChange: () => void }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const { wallet: me } = useAuth();
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = useQuery({
    queryKey: ["settlement", settlementId],
    enabled: !!settlementId && !!me,
    queryFn: () => api<SettlementView>(`/api/otc/settlement/${settlementId}`),
    refetchInterval: (q) => (q.state.data && ["SUBMITTED", "AWAITING_SELLER_SIGNATURE", "AWAITING_BUYER_SIGNATURE"].includes(q.state.data.status) ? 4000 : false),
  });

  async function prepare() {
    setError(null);
    setBusy("prepare");
    try {
      const view = await post<SettlementView>("/api/otc/settlement/prepare", { orderId: order.id });
      qc.setQueryData(["settlement", view.id], view);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const view = s.data;
  if (!view || ["FAILED", "EXPIRED"].includes(view.status)) {
    if (order.status !== "ACCEPTED" && order.status !== "SETTLEMENT_READY") return null;
    return (
      <div className="space-y-3">
        {view && <p className="text-[13px] text-warn">Previous settlement {view.status === "EXPIRED" ? "expired" : "failed"}: {view.failureReason}. Both parties must sign a fresh transaction.</p>}
        <p className="text-[13px] text-muted">Build the settlement transaction. We re-check both wallets' balances and the token right before building it.</p>
        <ErrorNote error={error} />
        {me && <Button onClick={() => void prepare()} loading={busy === "prepare"}>Build settlement transaction</Button>}
      </div>
    );
  }

  // Pre-signature verification only matters while signatures are being collected; afterwards the
  // order's filled amount already includes this fill and the receipt page verifies from chain.
  const collecting = view.status === "AWAITING_BUYER_SIGNATURE" || view.status === "AWAITING_SELLER_SIGNATURE";
  const check = me && collecting ? checkSettlement(cfg, order, view, me) : null;
  const d = check?.decoded;
  const sym = order.token.symbol || "tokens";
  const myTurn = check?.role === "buyer" ? view.status === "AWAITING_BUYER_SIGNATURE" : check?.role === "seller" ? view.status === "AWAITING_SELLER_SIGNATURE" : false;
  const net = BigInt(view.netTokenReceivedRaw);
  const gross = BigInt(view.terms.tokenAmountRaw);

  async function sign() {
    setError(null);
    setBusy("sign");
    try {
      const signed = await signOnly(wallet, toTxBase64(view!.messageBase64));
      const next = await post<SettlementView>("/api/otc/settlement/partial-signature", { settlementId: view!.id, signedTransactionBase64: signed });
      qc.setQueryData(["settlement", view!.id], next);
      toast.success(next.status === "CONFIRMED" ? "Trade settled" : "Signature recorded", next.status === "CONFIRMED" ? "Both legs settled in one transaction." : "Waiting for the other party to sign.");
      onChange();
    } catch (e) {
      if (e instanceof UserRejected) toast.info("Cancelled", e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusPill status={view.status} />
        <span className="text-[13px] text-muted">Attempt {view.attempt}</span>
        <span className="ml-auto flex gap-3 text-[13px] text-muted">
          <span className={view.buyerSigned ? "text-buy" : undefined}>Buyer {view.buyerSigned ? "signed" : "to sign"}</span>
          <span className={view.sellerSigned ? "text-buy" : undefined}>Seller {view.sellerSigned ? "signed" : "to sign"}</span>
        </span>
      </div>
      {check && !check.ok && (
        <ErrorNote error={`Do not sign. Your browser rejected this transaction: ${check.problems.join(" ")}`} />
      )}
      {check?.ok && d && check.role && (
        <div className="rounded-[var(--radius-control)] border border-line-strong p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[13px] text-muted">{check.role === "seller" ? "Selling" : "Paying"}</p>
              <p className="text-[22px] font-medium">
                {check.role === "seller" ? <Tokens raw={d.tokenTransfer.amount} decimals={order.token.decimals} symbol={sym} /> : <Sol lamports={BigInt(view.buyerPaysLamports)} />}
              </p>
            </div>
            <div>
              <p className="text-[13px] text-muted">Receiving</p>
              <p className="text-[22px] font-medium">
                {check.role === "seller" ? (
                  <>
                    <Sol lamports={BigInt(view.terms.sellerReceivesLamports)} /> <span className="text-[13px] text-muted">net</span>
                  </>
                ) : (
                  <Tokens raw={net} decimals={order.token.decimals} symbol={sym} />
                )}
              </p>
            </div>
          </div>
          <dl className="mt-3 border-t border-line pt-3 text-[13px]">
            <Row label="Counterparty"><Address value={check.role === "seller" ? view.buyer : view.seller} profile /></Row>
            <Row label="Platform fee"><Sol lamports={BigInt(view.terms.platformFeeLamports) + BigInt(view.terms.referralFeeLamports)} digits={6} /></Row>
            {view.terms.referrerWallet && <Row label="of which to referrer"><Sol lamports={view.terms.referralFeeLamports} digits={6} /></Row>}
            {gross !== net && <Row label="Token transfer fee (Token-2022)" hint="Withheld by the token program"><Tokens raw={gross - net} decimals={order.token.decimals} /></Row>}
            <Row label="Network fee estimate (paid by buyer)"><Sol lamports={view.networkFeeEstimateLamports} digits={6} /></Row>
            <Row label="Token mint"><Address value={d.tokenTransfer.mint} chars={6} /></Row>
            <Row label="Valid until block">{view.lastValidBlockHeight} (about 60–90 seconds after it was built)</Row>
            <Row label="Transaction hash"><span className="font-mono text-[12px] text-muted">{view.messageHash.slice(0, 20)}…</span></Row>
          </dl>
          <p className="mt-3 text-[13px]">Both transfers execute atomically: if the transaction succeeds, both legs settle; if it fails, neither does.</p>
          {myTurn && (
            <>
              <label className="mt-3 flex items-start gap-2 text-[13px]">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-[var(--color-glacier)]" />
                I checked the amounts, the counterparty and the token mint, and they match what I agreed.
              </label>
              <Button className="mt-3" size="lg" disabled={!confirmed} loading={busy === "sign"} onClick={() => void sign()}>
                {check.role === "seller" ? `Sign: sell ${sym} for SOL` : `Sign: pay SOL for ${sym}`}
              </Button>
            </>
          )}
          {!myTurn && view.status.startsWith("AWAITING") && <p className="mt-3 text-[13px] text-muted">{check.role === "buyer" ? "You signed. Waiting for the seller." : "Waiting for the buyer, who signs first."}</p>}
        </div>
      )}
      {view.txSignature && ["SUBMITTED", "CONFIRMED", "FINALIZED"].includes(view.status) && (
        <p className="text-[13px]">
          {view.status === "SUBMITTED" ? "Submitted. Waiting for confirmation… " : "Settled on chain. "}
          <Link href={`/trade/${view.txSignature}`} className="text-glacier hover:underline">View receipt</Link>
        </p>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

/** The API ships the compiled message; wrap it into an unsigned transaction for the wallet. */
function toTxBase64(messageBase64: string): string {
  return toBase64(new VersionedTransaction(VersionedMessage.deserialize(fromBase64(messageBase64))).serialize());
}
