"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { parseUnits, SOL_DECIMALS } from "@app/shared";
import { fromBase64 } from "@app/solana";
import { verifyTradeMessage } from "@app/pump/client";
import { api, post, ApiError } from "@/lib/api";
import { signAndSend, waitForConfirmation, UserRejected } from "@/lib/signing";
import { useSettings } from "@/lib/settings";
import { bps, price } from "@/lib/format";
import type { FeeLine, Quote, Snapshot } from "@/lib/types";
import { useAuth } from "@/components/providers/auth";
import { useConfig } from "@/components/providers/config";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Panel, Row } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ErrorNote } from "@/components/ui/skeleton";
import { Sol, Tokens } from "@/components/ui/amount";
import { toast } from "@/components/ui/toast";
import { VenueBadge } from "@/components/ui/status";
import { SlippageControl } from "./slippage";

interface Prepared {
  transactionBase64: string;
  networkFeeLamports: string;
  quote: Quote;
  fees: FeeLine[];
}

function useTokenBalance(mint: string, owner: PublicKey | null) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["token-balance", mint, owner?.toBase58()],
    enabled: !!owner,
    refetchInterval: 20_000,
    queryFn: async () => {
      const res = await connection.getParsedTokenAccountsByOwner(owner!, { mint: new PublicKey(mint) });
      return res.value.reduce((a, acc) => a + BigInt((acc.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount.amount), 0n);
    },
  });
}

export function TradePanel({ market, symbol }: { market: Snapshot; symbol: string }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { status, signIn, wallet: signedIn } = useAuth();
  const qc = useQueryClient();
  const { slippageBps, setSlippageBps } = useSettings();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [debounced, setDebounced] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState<"prepare" | "sign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const balance = useTokenBalance(market.mint, wallet.publicKey);
  const decimals = market.decimals;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amount.trim()), 350);
    return () => clearTimeout(t);
  }, [amount]);

  let raw: bigint | null = null;
  let parseError: string | null = null;
  if (debounced) {
    try {
      raw = parseUnits(debounced, side === "BUY" ? SOL_DECIMALS : decimals);
      if (raw === 0n) raw = null;
    } catch (e) {
      parseError = e instanceof Error ? e.message : "Invalid amount";
    }
  }
  if (side === "SELL" && raw !== null && balance.data !== undefined && raw > balance.data) parseError = "That's more than your balance.";

  const quote = useQuery({
    queryKey: ["quote", side, market.mint, raw?.toString(), slippageBps],
    enabled: raw !== null && !parseError && market.tradable,
    refetchInterval: 15_000,
    queryFn: () => api<{ quote: Quote; fees: FeeLine[] }>(`/api/quotes/${side === "BUY" ? "buy" : "sell"}?mint=${market.mint}&${side === "BUY" ? "lamports" : "amount"}=${raw}&slippageBps=${slippageBps}`),
  });

  const setPct = (p: number) => {
    if (!balance.data) return;
    const v = (balance.data * BigInt(p)) / 100n;
    const whole = v / 10n ** BigInt(decimals);
    const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
    setAmount(frac ? `${whole}.${frac}` : whole.toString());
  };

  async function review() {
    setError(null);
    if (status !== "signed-in" && !(await signIn())) return;
    setBusy("prepare");
    try {
      const p = await post<Prepared>("/api/trade/prepare", { side, mint: market.mint, amount: raw!.toString(), slippageBps });
      // Independent check of what the wallet will be asked to sign.
      const problems = verifyTradeMessage(VersionedTransaction.deserialize(fromBase64(p.transactionBase64)).message.serialize(), {
        user: wallet.publicKey!.toBase58(),
        side,
        venue: p.quote.venue as "PUMP_BONDING_CURVE" | "PUMPSWAP",
        inputAmount: BigInt(p.quote.inputAmount),
        minOutput: BigInt(p.quote.minOutput),
        maxInput: BigInt(p.quote.maxInput),
        expectedOutput: BigInt(p.quote.expectedOutput),
      });
      if (problems.length) throw new Error(`Transaction rejected by your browser's safety check: ${problems.join("; ")}`);
      setPrepared(p);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sign() {
    if (!prepared) return;
    setBusy("sign");
    try {
      const sig = await signAndSend(wallet, connection, prepared.transactionBase64, { kind: side, mint: market.mint });
      setPrepared(null);
      toast.info("Transaction submitted", "Waiting for confirmation…");
      const result = await waitForConfirmation(sig);
      if (result === "failed") toast.error("Transaction failed on chain", "Nothing was traded. The quote may have moved beyond your slippage.");
      else if (result === "timeout") toast.info("Still confirming", "Check your wallet's activity for the final status.");
      else toast.success(side === "BUY" ? "Bought" : "Sold", `${symbol} trade confirmed.`);
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["token-balance"] });
      void qc.invalidateQueries({ queryKey: ["token", market.mint] });
    } catch (e) {
      if (!(e instanceof UserRejected)) toast.error("Couldn't complete the trade", e instanceof Error ? e.message : String(e));
      else toast.info("Cancelled", e.message);
    } finally {
      setBusy(null);
    }
  }

  const q = quote.data?.quote;
  const disabled = !market.tradable || !cfg.transactionsEnabled;
  return (
    <Panel className="p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Segmented value={side} onChange={(v) => { setSide(v); setAmount(""); }} options={[{ value: "BUY", label: "Buy", tone: "buy" }, { value: "SELL", label: "Sell", tone: "sell" }]} className="w-40" />
        <SlippageControl value={slippageBps} onChange={setSlippageBps} />
      </div>
      {!market.tradable && <ErrorNote className="mb-3" error={market.note ?? "No tradable Pump market."} />}
      {!cfg.transactionsEnabled && <ErrorNote className="mb-3" error="Trading is disabled on this deployment." />}
      <label className="mb-1.5 flex items-baseline justify-between text-[13px] text-muted">
        <span>{side === "BUY" ? "You pay" : "You sell"}</span>
        {side === "SELL" && signedIn && balance.data !== undefined && (
          <span>
            Balance <Tokens raw={balance.data} decimals={decimals} />
          </span>
        )}
      </label>
      <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" suffix={side === "BUY" ? "SOL" : symbol} invalid={!!parseError} disabled={disabled} aria-label="Amount" />
      <div className="mt-2 flex gap-1.5">
        {side === "BUY"
          ? ["0.1", "0.5", "1", "5"].map((v) => (
              <Button key={v} size="sm" variant="outline" className="flex-1" onClick={() => setAmount(v)} disabled={disabled}>
                {v}
              </Button>
            ))
          : [25, 50, 75, 100].map((p) => (
              <Button key={p} size="sm" variant="outline" className="flex-1" onClick={() => setPct(p)} disabled={disabled || !balance.data}>
                {p}%
              </Button>
            ))}
      </div>
      {parseError && <p className="mt-2 text-[13px] text-sell">{parseError}</p>}

      <dl className="mt-4 border-t border-line pt-3 text-[13px]">
        <Row label={side === "BUY" ? "Expected tokens" : "Expected SOL"}>{q ? side === "BUY" ? <Tokens raw={q.expectedOutput} decimals={decimals} symbol={symbol} /> : <Sol lamports={q.expectedOutput} /> : "—"}</Row>
        <Row label="Minimum received">{q ? side === "BUY" ? <Tokens raw={q.minOutput} decimals={decimals} symbol={symbol} /> : <Sol lamports={q.minOutput} /> : "—"}</Row>
        {q && q.maxInput !== q.inputAmount && <Row label="Maximum SOL spent"><Sol lamports={q.maxInput} /></Row>}
        <Row label="Price impact">
          <span className={q && q.priceImpactBps > 500 ? "text-warn" : undefined}>{q ? bps(q.priceImpactBps) : "—"}</span>
        </Row>
        {quote.data?.fees.map((f) => (
          <Row key={f.label} label={f.label}>
            <Sol lamports={f.lamports} digits={6} />
          </Row>
        ))}
        <Row label="Slippage tolerance">{bps(slippageBps)}</Row>
        <Row label="Route">
          <span className="text-[13px] text-muted">{q?.route ?? <VenueBadge venue={market.venue} />}</span>
        </Row>
      </dl>
      {quote.error && <ErrorNote className="mt-2" error={quote.error} />}
      {q && <p className="mt-2 text-[13px] text-faint">Estimate from slot {q.slot} at {new Date(q.quotedAt).toLocaleTimeString()}. Prices move; the minimum above is enforced on chain.</p>}
      {error && <ErrorNote className="mt-3" error={error} />}

      {!wallet.connected ? (
        <p className="mt-4 text-center text-[13px] text-muted">Connect a wallet to trade.</p>
      ) : (
        <Button className="mt-4" block size="lg" variant={side === "BUY" ? "buy" : "sell"} disabled={disabled || raw === null || !!parseError || !q} loading={busy === "prepare"} onClick={() => void review()}>
          Review {side === "BUY" ? "buy" : "sell"}
        </Button>
      )}

      <Dialog open={!!prepared} onOpenChange={(o) => !o && setPrepared(null)} title={`Confirm ${side === "BUY" ? "buy" : "sell"}`} description="Check these figures in your wallet too. They were verified against the transaction you are about to sign.">
        {prepared && (
          <div className="space-y-4">
            <dl className="text-[14px]">
              <Row label="You send">{side === "BUY" ? <Sol lamports={prepared.quote.maxInput} /> : <Tokens raw={prepared.quote.inputAmount} decimals={decimals} symbol={symbol} />}</Row>
              <Row label="You receive at least">{side === "BUY" ? <Tokens raw={prepared.quote.minOutput} decimals={decimals} symbol={symbol} /> : <Sol lamports={prepared.quote.minOutput} />}</Row>
              <Row label="Expected">{side === "BUY" ? <Tokens raw={prepared.quote.expectedOutput} decimals={decimals} symbol={symbol} /> : <Sol lamports={prepared.quote.expectedOutput} />}</Row>
              <Row label="Price per token">{price(prepared.quote.executionPriceSolPerToken)} SOL</Row>
              {prepared.fees.map((f) => (
                <Row key={f.label} label={f.label}>
                  <Sol lamports={f.lamports} digits={6} />
                </Row>
              ))}
              <Row label="Network fee (estimate)"><Sol lamports={prepared.networkFeeLamports} digits={6} /></Row>
              <Row label="Token mint"><span className="font-mono text-[13px]">{market.mint.slice(0, 6)}…{market.mint.slice(-6)}</span></Row>
              <Row label="Route"><span className="text-[13px]">{prepared.quote.route}</span></Row>
            </dl>
            <p className="text-[13px] text-muted">If the market moves past your {bps(prepared.quote.slippageBps)} slippage before confirmation, the transaction fails and nothing is traded (you only pay the network fee).</p>
            <Button block size="lg" variant={side === "BUY" ? "buy" : "sell"} loading={busy === "sign"} onClick={() => void sign()}>
              Sign and {side === "BUY" ? "buy" : "sell"} in wallet
            </Button>
          </div>
        )}
      </Dialog>
    </Panel>
  );
}
