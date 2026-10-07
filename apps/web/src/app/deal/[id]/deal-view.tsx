"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseUnits, relativeTime } from "@app/shared";
import { quoteForFill, type NegotiationView, type OrderView } from "@app/otc";
import { api } from "@/lib/api";
import { acceptOrder, cancelOrder } from "@/lib/otc-client";
import { UserRejected } from "@/lib/signing";
import { useAuth } from "@/components/providers/auth";
import { useConfig } from "@/components/providers/config";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ErrorNote, Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status";
import { toast } from "@/components/ui/toast";
import { CounterForm } from "@/components/otc/counter-form";
import { MarketComparison } from "@/components/otc/market-comparison";
import { OrderTerms } from "@/components/otc/order-terms";
import { SettlementPanel } from "@/components/otc/settlement-panel";

type Deal = { restricted: true; isPrivate: true } | { restricted: false; order: OrderView; negotiation: NegotiationView | null; latestSettlementId: string | null };

export function DealView({ publicId }: { publicId: string }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const router = useRouter();
  const qc = useQueryClient();
  const { wallet: me, status, signIn, signingIn } = useAuth();
  const [mode, setMode] = useState<"none" | "counter">("none");
  const [fill, setFill] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, error: loadError, refetch } = useQuery({ queryKey: ["deal", publicId, me], queryFn: () => api<Deal>(`/api/otc/deals/${publicId}`), refetchInterval: 10_000 });

  if (isLoading) return <Skeleton className="h-96" />;
  if (loadError) return <ErrorNote error={loadError} />;
  if (!data) return null;
  if (data.restricted)
    return (
      <Panel className="mx-auto max-w-lg p-6">
        <Lock className="mb-3 size-5 text-muted" />
        <h1 className="title-display text-[30px]">Private offer</h1>
        <p className="mt-2 text-muted">Only the two wallets in this deal can see its terms. Having the link is not enough.</p>
        <div className="mt-4">
          {status === "signed-in" ? <p className="text-[13px] text-faint">Your connected wallet is not a party to this deal.</p> : <Button onClick={() => void signIn()} loading={signingIn} disabled={!wallet.connected}>{wallet.connected ? "Sign in with the designated wallet" : "Connect the designated wallet"}</Button>}
        </div>
      </Panel>
    );

  const order = data.order;
  const thread = data.negotiation;
  const isMaker = me === order.makerWallet;
  const canAct = !!me && !isMaker && (!order.takerWallet || order.takerWallet === me);
  const latest = !thread || thread.latestOrderId === order.id;
  const acceptable = (order.status === "OPEN" || order.status === "PARTIALLY_FILLED") && latest && new Date(order.expiresAt) > new Date();
  const sym = order.token.symbol || "tokens";
  const remaining = BigInt(order.remainingAmountRaw);
  let fillRaw = remaining;
  let fillError: string | null = null;
  if (order.allowPartialFill && fill) {
    try {
      fillRaw = parseUnits(fill, order.token.decimals);
      if (fillRaw > remaining) fillError = "More than the remaining quantity.";
      else if (fillRaw < BigInt(order.minimumFillAmountRaw) && fillRaw !== remaining) fillError = "Below this order's minimum fill.";
    } catch (e) {
      fillError = e instanceof Error ? e.message : "Invalid amount";
    }
  }
  const fillQuote = quoteForFill({ side: order.side, tokenAmountRaw: BigInt(order.tokenAmountRaw), quoteAmountRaw: BigInt(order.quoteAmountRaw) }, BigInt(order.filledAmountRaw), fillRaw > 0n && fillRaw <= remaining ? fillRaw : remaining);

  const refresh = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ["settlement"] });
  };

  async function run(label: string, fn: () => Promise<unknown>, success: string) {
    setError(null);
    setBusy(label);
    try {
      await fn();
      toast.success(success);
      refresh();
    } catch (e) {
      if (e instanceof UserRejected) toast.info("Cancelled", e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        <Panel className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link href={`/token/${order.token.mint}`} className="text-[13px] text-muted hover:text-text">{order.token.name || "Token"} ({sym})</Link>
            {order.isPrivate && <span className="inline-flex items-center gap-1 text-[13px] text-muted"><Lock className="size-3" />Private deal</span>}
          </div>
          <OrderTerms order={order} />
        </Panel>

        {(acceptable || order.status === "ACCEPTED" || order.status === "SETTLEMENT_READY") && (
          <Panel>
            <PanelHeader title="Compared with the Pump market" />
            <div className="p-4">
              <MarketComparison mint={order.token.mint} side={order.side === "SELL" ? "SELL" : "BUY"} tokenAmountRaw={fillRaw} quoteLamports={fillQuote} symbol={sym} />
            </div>
          </Panel>
        )}

        {thread && (
          <Panel>
            <PanelHeader title="Negotiation" />
            <ol className="space-y-3 p-4">
              {thread.revisions.map((r) => {
                const mine = r.makerWallet === me;
                return (
                  <li key={r.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <Link href={`/deal/${r.publicId}`} className={`block max-w-[85%] rounded-[var(--radius-panel)] border px-4 py-3 ${r.id === order.id ? "border-glacier/60" : "border-line"} ${mine ? "bg-raised" : "bg-panel"}`}>
                      <div className="flex items-center gap-2 text-[13px] text-muted">
                        <span>{mine ? "You" : <Address value={r.makerWallet} />}</span>
                        <span>{r.revision === 0 ? "opened" : "countered"}</span>
                        <span className="text-faint">{relativeTime(r.createdAt)}</span>
                        <StatusPill status={r.status} />
                      </div>
                      <p className="mt-1">
                        {r.side === "SELL" ? "Sell" : "Buy"} <Tokens raw={r.tokenAmountRaw} decimals={r.token.decimals} symbol={sym} /> for <Sol lamports={r.quoteAmountRaw} digits={4} />
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Panel>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Panel className="space-y-4 p-4">
          <h2 className="font-semibold">Next step</h2>
          {status !== "signed-in" && <Button block onClick={() => void signIn()} loading={signingIn} disabled={!wallet.connected}>{wallet.connected ? "Sign in to act on this deal" : "Connect a wallet to act on this deal"}</Button>}

          {canAct && acceptable && (
            <div className="space-y-3">
              {order.allowPartialFill && (
                <Field label={`Quantity to ${order.side === "SELL" ? "buy" : "sell"}`} error={fillError} hint="Leave empty to take the full remaining amount.">
                  <Input value={fill} onChange={(e) => setFill(e.target.value)} inputMode="decimal" suffix={sym} />
                </Field>
              )}
              <p className="text-[13px] text-muted">
                Accepting reserves this order for you and opens settlement. You will review and sign the actual transaction next; nothing moves until both wallets sign.
              </p>
              <Button block size="lg" variant={order.side === "SELL" ? "buy" : "sell"} disabled={!!fillError} loading={busy === "accept"} onClick={() => void run("accept", async () => { await acceptOrder(wallet, cfg, order, fillRaw); }, "Accepted. Next: build and sign the settlement.")}>
                Accept: {order.side === "SELL" ? "buy" : "sell"} <Tokens raw={fillRaw} decimals={order.token.decimals} /> for <Sol lamports={fillQuote} digits={4} unit />
              </Button>
              <Button block variant="outline" onClick={() => setMode(mode === "counter" ? "none" : "counter")}>Counteroffer</Button>
            </div>
          )}
          {isMaker && acceptable && <p className="text-[13px] text-muted">Waiting for a counterparty. You'll be notified when someone accepts or counters.</p>}
          {!acceptable && order.status === "NEGOTIATING" && thread && (
            <p className="text-[13px] text-muted">
              This revision was countered. <button className="text-glacier hover:underline" onClick={() => router.push(`/deal/${thread.revisions.find((r) => r.id === thread.latestOrderId)?.publicId ?? publicId}`)}>Open the latest terms</button>
            </p>
          )}
          {(order.status === "ACCEPTED" || order.status === "SETTLEMENT_READY" || data.latestSettlementId) && me && (
            <SettlementPanel order={order} settlementId={data.latestSettlementId} onChange={refresh} />
          )}
          {isMaker && ["OPEN", "NEGOTIATING", "ACCEPTED", "SETTLEMENT_READY", "PARTIALLY_FILLED"].includes(order.status) && (
            <Button block variant="danger" loading={busy === "cancel"} onClick={() => void run("cancel", async () => { await cancelOrder(wallet, cfg, order); }, "Order cancelled")}>
              Cancel this order
            </Button>
          )}
          {order.status === "FILLED" && <p className="text-[13px] text-buy">This order is filled. See the receipt from the settlement above or in your portfolio.</p>}
          <ErrorNote error={error} />
        </Panel>
        {mode === "counter" && canAct && acceptable && (
          <Panel className="p-4">
            <h2 className="mb-3 font-semibold">Your counteroffer</h2>
            <CounterForm parent={order} onDone={(o) => router.push(`/deal/${o.publicId}`)} />
          </Panel>
        )}
      </aside>
    </div>
  );
}
