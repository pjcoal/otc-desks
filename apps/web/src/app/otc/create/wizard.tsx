"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { D, isBase58PublicKey, parseUnits, SOL_DECIMALS, unitPrice } from "@app/shared";
import type { OrderView } from "@app/otc";
import { api } from "@/lib/api";
import { publishOrder } from "@/lib/otc-client";
import { UserRejected } from "@/lib/signing";
import { pct, price } from "@/lib/format";
import type { TokenDetail } from "@/lib/types";
import { useAuth } from "@/components/providers/auth";
import { useConfig } from "@/components/providers/config";
import { Sol, Tokens } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ErrorNote } from "@/components/ui/skeleton";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { toast } from "@/components/ui/toast";
import { MarketComparison } from "@/components/otc/market-comparison";
import { cn } from "@/lib/cn";

const STEPS = ["Token", "Buy or sell", "Quantity", "Price", "Visibility", "Expiry", "Compare", "Sign"] as const;
const EXPIRY = [
  { value: "3600", label: "1 hour" },
  { value: "21600", label: "6 hours" },
  { value: "86400", label: "24 hours" },
  { value: "259200", label: "3 days" },
  { value: "604800", label: "7 days" },
];

function tryParse(v: string, decimals: number): bigint | null {
  try {
    const r = parseUnits(v, decimals);
    return r > 0n ? r : null;
  } catch {
    return null;
  }
}

export function CreateWizard() {
  const cfg = useConfig();
  const params = useSearchParams();
  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { status, signIn, signingIn } = useAuth();
  const [step, setStep] = useState(params.get("mint") ? 1 : 0);
  const [mint, setMint] = useState(params.get("mint") ?? "");
  const [side, setSide] = useState<"SELL" | "BUY">(params.get("side") === "BUY" ? "BUY" : "SELL");
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [ttl, setTtl] = useState("86400");
  const [partial, setPartial] = useState(false);
  const [minFill, setMinFill] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<OrderView | null>(null);
  const [copied, setCopied] = useState(false);

  const validMint = isBase58PublicKey(mint.trim());
  const token = useQuery({ queryKey: ["token", mint.trim()], enabled: validMint, queryFn: () => api<TokenDetail>(`/api/tokens/${mint.trim()}`) });
  const t = token.data;
  const decimals = t?.token.decimals ?? 6;
  const balance = useQuery({
    queryKey: ["token-balance", mint, wallet.publicKey?.toBase58()],
    enabled: !!wallet.publicKey && validMint,
    queryFn: async () => {
      const r = await connection.getParsedTokenAccountsByOwner(wallet.publicKey!, { mint: new PublicKey(mint.trim()) });
      return r.value.reduce((a, x) => a + BigInt((x.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount.amount), 0n);
    },
  });

  const qtyRaw = tryParse(qty, decimals);
  const totalRaw = tryParse(total, SOL_DECIMALS);
  const minFillRaw = partial ? tryParse(minFill, decimals) : qtyRaw;
  const otcPrice = qtyRaw && totalRaw ? unitPrice(totalRaw, SOL_DECIMALS, qtyRaw, decimals) : null;
  const market = t && t.market.priceSolPerToken !== "0" ? new D(t.market.priceSolPerToken) : null;
  const premium = otcPrice && market ? otcPrice.sub(market).div(market).mul(100) : null;
  const ttlOptions = EXPIRY.filter((e) => Number(e.value) >= cfg.minTtlSeconds && Number(e.value) <= cfg.maxTtlSeconds);

  const stepValid = [
    validMint && !!t && t.safety.ok,
    true,
    !!qtyRaw,
    !!totalRaw,
    visibility === "public" || (isBase58PublicKey(recipient.trim()) && recipient.trim() !== wallet.publicKey?.toBase58()),
    !partial || (!!minFillRaw && !!qtyRaw && minFillRaw <= qtyRaw),
    true,
    true,
  ];

  async function sign() {
    setError(null);
    if (status !== "signed-in" && !(await signIn())) return;
    setBusy(true);
    try {
      const order = await publishOrder(wallet, cfg, {
        takerWallet: visibility === "private" ? recipient.trim() : null,
        tokenMint: mint.trim(),
        tokenProgram: t!.token.tokenProgram,
        tokenDecimals: decimals,
        side,
        tokenAmountRaw: qtyRaw!,
        quoteAmountRaw: totalRaw!,
        ttlSeconds: Number(ttl),
        allowPartialFill: partial,
        minimumFillAmountRaw: partial ? minFillRaw! : qtyRaw!,
        note: note.trim() || null,
      });
      setPublished(order);
      toast.success(order.isPrivate ? "Private offer sent" : "Offer published");
    } catch (e) {
      if (e instanceof UserRejected) toast.info("Not signed", e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (published) {
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/deal/${published.publicId}`;
    return (
      <Panel className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="title-display text-[34px]">{published.isPrivate ? "Private offer sent" : "Your offer is live"}</h1>
        <p className="text-muted">{published.isPrivate ? "Share this link with the recipient. Only their wallet can open the terms or accept. The link alone grants nothing." : "It appears in the token's OTC book. You'll be notified when someone accepts or counters."}</p>
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-ink px-3 py-2">
          <span className="truncate font-mono text-[12px]">{link}</span>
          <button className="ml-auto text-muted hover:text-text" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => router.push(`/deal/${published.publicId}`)}>Open deal</Button>
          <Link href={`/token/${published.token.mint}`} className="inline-flex h-10 items-center px-4 text-muted hover:text-text">Back to token</Link>
        </div>
      </Panel>
    );
  }

  const sym = t?.token.symbol ?? "tokens";
  return (
    <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[200px_1fr]">
      <div>
        <h1 className="title-display mb-4 text-[34px] leading-none">New OTC offer</h1>
        <ol className="space-y-0.5">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" disabled={i > step} onClick={() => setStep(i)} className={cn("flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-[13px]", i === step ? "bg-raised text-text" : i < step ? "text-muted hover:text-text" : "text-faint")}>
                <span className={cn("num flex size-5 items-center justify-center rounded-full border text-[11px]", i < step ? "border-buy text-buy" : i === step ? "border-text" : "border-line")}>{i < step ? <Check className="size-3" /> : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <Panel className="space-y-5 p-5">
        {step === 0 && (
          <Field label="Token mint address" htmlFor="w-mint" hint="Paste the Pump token's mint. You can also start from any token page." error={validMint && token.error ? (token.error as Error).message : null}>
            <Input id="w-mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Mint address" />
          </Field>
        )}
        {t && step <= 1 && (
          <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line p-3">
            <TokenAvatar src={t.token.imageUrl} symbol={t.token.symbol} size={36} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.token.name} <span className="text-muted">{t.token.symbol}</span></p>
              <p className="text-[12px] text-muted">Pump price {price(t.market.priceSolPerToken)} SOL</p>
            </div>
            {!t.safety.ok && <span className="text-[12px] text-sell">Not eligible: {t.safety.blockers[0]}</span>}
          </div>
        )}
        {step === 1 && (
          <Field label="What do you want to do?">
            <Segmented value={side} onChange={setSide} options={[{ value: "SELL", label: `Sell ${sym}`, tone: "sell" }, { value: "BUY", label: `Buy ${sym}`, tone: "buy" }]} className="w-full max-w-sm" />
          </Field>
        )}
        {step === 2 && (
          <Field
            label={`How many ${sym}?`}
            htmlFor="w-qty"
            hint={side === "SELL" && qtyRaw && balance.data !== undefined && qtyRaw > balance.data ? "Your wallet currently shows less than this. Your balance is checked when you publish and again before settlement." : "Quantity in whole tokens."}
          >
            <Input id="w-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" suffix={sym} autoFocus />
            {side === "SELL" && balance.data !== undefined && (
              <p className="text-[12px] text-muted">
                You hold <Tokens raw={balance.data} decimals={decimals} symbol={sym} />.{" "}
                <button className="text-glacier hover:underline" onClick={() => setQty((balance.data! / 10n ** BigInt(decimals)).toString())}>Use all</button>
              </p>
            )}
          </Field>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <Field label="Total price for the whole block" htmlFor="w-total">
              <Input id="w-total" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" suffix="SOL" autoFocus />
            </Field>
            {otcPrice && (
              <p className="text-[13px] text-muted">
                That is {price(otcPrice.toFixed())} SOL per token{premium && <>, <span className={premium.lt(0) ? "text-sell" : "text-buy"}>{pct(premium)}</span> vs the current Pump price (estimate)</>}.
              </p>
            )}
          </div>
        )}
        {step === 4 && (
          <div className="space-y-4">
            <Segmented value={visibility} onChange={setVisibility} options={[{ value: "public", label: "Public offer" }, { value: "private", label: "Private to one wallet" }]} className="w-full max-w-sm" />
            <p className="text-[13px] text-muted">{visibility === "public" ? "Anyone can see and accept it in the token's OTC book." : "Only the wallet you name can see the terms or accept. You'll get a link to share with them."}</p>
            {visibility === "private" && (
              <Field label="Recipient wallet" htmlFor="w-recipient" error={recipient && !isBase58PublicKey(recipient.trim()) ? "Not a valid Solana address." : recipient.trim() === wallet.publicKey?.toBase58() ? "That's your own wallet." : null}>
                <Input id="w-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Wallet address" />
              </Field>
            )}
            <Field label="Note (optional, part of the signed order)" hint="One line, up to 280 characters.">
              <Textarea value={note} onChange={(e) => setNote(e.target.value.replace(/[\r\n]+/g, " ").slice(0, 280))} rows={2} />
            </Field>
          </div>
        )}
        {step === 5 && (
          <div className="space-y-4">
            <Field label="Offer expires in">
              <Segmented value={ttl} onChange={setTtl} options={ttlOptions} className="flex-wrap" />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="accent-[var(--color-glacier)]" />
              Allow partial fills
            </label>
            {partial && (
              <Field label="Minimum fill" htmlFor="w-minfill" hint="Smallest piece a counterparty may take (the final remainder can be smaller).">
                <Input id="w-minfill" value={minFill} onChange={(e) => setMinFill(e.target.value)} inputMode="decimal" suffix={sym} />
              </Field>
            )}
          </div>
        )}
        {step === 6 && t && qtyRaw && totalRaw && <MarketComparison mint={mint.trim()} side={side} tokenAmountRaw={qtyRaw} quoteLamports={totalRaw} symbol={sym} />}
        {step === 7 && qtyRaw && totalRaw && (
          <div className="space-y-3">
            <p className="text-[20px] font-medium">
              {side === "SELL" ? "Sell" : "Buy"} <Tokens raw={qtyRaw} decimals={decimals} symbol={sym} /> for <Sol lamports={totalRaw} />
            </p>
            <ul className="space-y-1 text-[13px] text-muted">
              <li>{visibility === "private" ? `Private to ${recipient.trim()}` : "Public offer"}, expires in {EXPIRY.find((e) => e.value === ttl)?.label}.</li>
              <li>Platform fee {cfg.platformFeeBps / 100}% ({cfg.feeMode === "SELLER_PAYS" ? "paid by the seller" : cfg.feeMode === "BUYER_PAYS" ? "paid by the buyer" : "split"}), included in the signed order.</li>
              <li>Signing is free and moves no funds. Your tokens or SOL stay in your wallet until you co-sign a settlement.</li>
            </ul>
            <ErrorNote error={error} />
            <Button size="lg" onClick={() => void sign()} loading={busy || signingIn} disabled={!wallet.connected}>
              {wallet.connected ? "Sign and publish offer" : "Connect a wallet to sign"}
            </Button>
          </div>
        )}

        {step < 7 && (
          <div className="flex justify-between border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</Button>
            <Button onClick={() => setStep(step + 1)} disabled={!stepValid[step]}>Continue</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
