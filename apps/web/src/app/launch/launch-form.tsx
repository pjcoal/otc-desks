"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseUnits, SOL_DECIMALS } from "@app/shared";
import { fromBase64 } from "@app/solana";
import { verifyTradeMessage } from "@app/pump/client";
import { post } from "@/lib/api";
import { signAndSend, UserRejected, waitForConfirmation } from "@/lib/signing";
import { useSettings } from "@/lib/settings";
import type { Quote } from "@/lib/types";
import { useAuth } from "@/components/providers/auth";
import { useConfig } from "@/components/providers/config";
import { Address } from "@/components/ui/address";
import { Sol, Tokens } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Panel, Row } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ErrorNote } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { SlippageControl } from "@/components/token/slippage";

interface Prepared {
  transactionBase64: string;
  networkFeeLamports: string;
  summary: { mint: string; creator: string; bondingCurve: string; tokenProgram: string; instruction: string; initialBuy: Quote | null };
}

export function LaunchForm() {
  const cfg = useConfig();
  const wallet = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const { status, signIn } = useAuth();
  const { slippageBps, setSlippageBps } = useSettings();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "create_buy">("create");
  const [initialBuy, setInitialBuy] = useState("");
  const [holderReward, setHolderReward] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [metadataUri, setMetadataUri] = useState<string | null>(null);
  const mintRef = useRef<Keypair | null>(null); // lives only in this tab's memory
  const [ack, setAck] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  let buyLamports = 0n;
  let buyError: string | null = null;
  if (mode === "create_buy") {
    try {
      buyLamports = parseUnits(initialBuy || "0", SOL_DECIMALS);
      if (buyLamports === 0n) buyError = "Enter how much SOL to spend on the first buy.";
    } catch (e) {
      buyError = e instanceof Error ? e.message : "Invalid amount";
    }
  }
  const formValid = name.trim().length > 0 && name.length <= 32 && /^[A-Za-z0-9$_.-]{1,10}$/.test(symbol.trim()) && !!file && !buyError;

  async function prepare() {
    setError(null);
    if (status !== "signed-in" && !(await signIn())) return;
    setBusy("prepare");
    try {
      let uri = metadataUri;
      if (!uri) {
        const form = new FormData();
        form.set("name", name.trim());
        form.set("symbol", symbol.trim());
        form.set("description", description.trim());
        if (website.trim()) form.set("website", website.trim());
        if (twitter.trim()) form.set("twitter", twitter.trim());
        if (telegram.trim()) form.set("telegram", telegram.trim());
        form.set("image", file!);
        const res = await fetch("/api/launch/metadata", { method: "POST", body: form, headers: { "x-requested-with": "fetch" } });
        const json = (await res.json()) as { uri?: string; error?: { message: string } };
        if (!res.ok || !json.uri) throw new Error(json.error?.message ?? "Metadata upload failed.");
        uri = json.uri;
        setMetadataUri(uri);
      }
      mintRef.current ??= Keypair.generate();
      const mint = mintRef.current.publicKey.toBase58();
      const p = await post<Prepared>("/api/launch/prepare", { mint, name: name.trim(), symbol: symbol.trim(), uri, initialBuyLamports: buyLamports.toString(), slippageBps, holderReward });
      const q = p.summary.initialBuy;
      const problems = verifyTradeMessage(VersionedTransaction.deserialize(fromBase64(p.transactionBase64)).message.serialize(), {
        user: wallet.publicKey!.toBase58(),
        side: "BUY",
        venue: "PUMP_BONDING_CURVE",
        inputAmount: BigInt(q?.inputAmount ?? 0),
        minOutput: BigInt(q?.minOutput ?? 0),
        maxInput: BigInt(q?.maxInput ?? 0),
        expectedOutput: BigInt(q?.expectedOutput ?? 0),
        extraSigners: [mint],
        allowCreate: true,
        createOnly: !q,
        mint,
      });
      if (problems.length) throw new Error(`Rejected by your browser's safety check: ${problems.join("; ")}`);
      setPrepared(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    if (!prepared || !mintRef.current) return;
    setBusy("sign");
    try {
      const sig = await signAndSend(wallet, connection, prepared.transactionBase64, { extraSigners: [mintRef.current], kind: "LAUNCH", mint: prepared.summary.mint });
      toast.info("Launch submitted", "Waiting for confirmation…");
      const r = await waitForConfirmation(sig);
      if (r === "failed") throw new Error("The launch transaction failed on chain. Nothing was created.");
      await post("/api/launch/confirm", { signature: sig, mint: prepared.summary.mint });
      toast.success(`${symbol.trim()} launched`, "It's trading on the Pump bonding curve.");
      router.push(`/token/${prepared.summary.mint}`);
    } catch (e) {
      if (e instanceof UserRejected) toast.info("Not launched", e.message);
      else setError(e instanceof Error ? e.message : String(e));
      setPrepared(null);
    } finally {
      setBusy(null);
    }
  }

  if (prepared) {
    const q = prepared.summary.initialBuy;
    return (
      <Panel className="mx-auto max-w-2xl space-y-5 p-6">
        <h1 className="title-display text-[36px]">Confirm launch</h1>
        <div className="flex items-center gap-4">
          {preview && (
            <img src={preview} alt="" className="size-16 rounded-full border border-line object-cover" />
          )}
          <div>
            <p className="text-[20px] font-medium">{name.trim()} <span className="text-muted">{symbol.trim()}</span></p>
            <p className="max-w-prose text-[13px] text-muted">{description.trim() || "No description"}</p>
          </div>
        </div>
        <dl className="text-[14px]">
          <Row label="Mint address" hint="Generated in your browser; its private key never leaves this tab"><Address value={prepared.summary.mint} chars={6} /></Row>
          <Row label="Creator wallet"><Address value={prepared.summary.creator} /></Row>
          <Row label="Instruction">{prepared.summary.instruction}</Row>
          <Row label="Token program">{prepared.summary.tokenProgram}</Row>
          <Row label="Metadata">{metadataUri && <a href={metadataUri} target="_blank" rel="noreferrer noopener" className="break-all text-[13px] text-glacier hover:underline">{metadataUri}</a>}</Row>
          {holderReward && <Row label="Creator fees">Paid to holders (holder-reward coin, permanent)</Row>}
          {q ? (
            <>
              <Row label="Initial buy"><Sol lamports={q.inputAmount} /></Row>
              <Row label="Expected tokens"><Tokens raw={q.expectedOutput} decimals={6} symbol={symbol.trim()} /></Row>
              <Row label="Minimum tokens"><Tokens raw={q.minOutput} decimals={6} symbol={symbol.trim()} /></Row>
              <Row label="Pump fees on the buy (estimate)"><Sol lamports={(BigInt(q.protocolFeeLamports) + BigInt(q.creatorFeeLamports)).toString()} digits={6} /></Row>
            </>
          ) : (
            <Row label="Initial buy">None (create only)</Row>
          )}
          <Row label="Network fee (estimate)" hint="Plus rent for the new accounts"><Sol lamports={prepared.networkFeeLamports} digits={6} /></Row>
        </dl>
        <ul className="space-y-1 rounded-[var(--radius-control)] border border-warn/30 bg-warn-dim/30 p-3 text-[13px] text-warn">
          <li>Launching is permanent. The name, ticker and image can't be changed afterwards.</li>
          <li>The token trades on Pump's bonding curve from the moment it's created; its price can fall to near zero.</li>
          <li>You'll sign one transaction in your wallet; the mint keypair adds its signature locally.</li>
        </ul>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--color-glacier)]" />
          I understand and want to create this token{q ? " and make the initial buy" : ""}.
        </label>
        <ErrorNote error={error} />
        <div className="flex gap-3">
          <Button size="lg" disabled={!ack} loading={busy === "sign"} onClick={() => void launch()}>
            {q ? "Sign: create and buy" : "Sign: create token"}
          </Button>
          <Button size="lg" variant="ghost" onClick={() => setPrepared(null)}>Edit details</Button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="title-display text-[30px] leading-none">Launch on Pump</h1>
        <p className="mt-2 text-muted">Creates a Token-2022 coin through Pump's create_v2 instruction. You sign with your own wallet; the mint key is generated in your browser.</p>
      </div>
      <Panel className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-panel)] border border-dashed border-line-strong text-[13px] text-muted hover:bg-hover">
            {preview ? (
              <img src={preview} alt="Token image preview" className="size-full object-cover" />
            ) : (
              <>
                <ImagePlus className="size-5" />
                Image
              </>
            )}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMetadataUri(null); }} />
          </label>
          <div className="space-y-4">
            <Field label="Name" htmlFor="name" hint={`${name.length}/32`}>
              <Input id="name" value={name} maxLength={32} onChange={(e) => { setName(e.target.value); setMetadataUri(null); }} />
            </Field>
            <Field label="Ticker" htmlFor="symbol" hint="Up to 10 letters or digits">
              <Input id="symbol" value={symbol} maxLength={10} onChange={(e) => { setSymbol(e.target.value.replace(/\s/g, "")); setMetadataUri(null); }} />
            </Field>
          </div>
        </div>
        <Field label="Description" htmlFor="desc">
          <Textarea id="desc" value={description} maxLength={1000} onChange={(e) => { setDescription(e.target.value); setMetadataUri(null); }} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Website" htmlFor="web"><Input id="web" value={website} onChange={(e) => { setWebsite(e.target.value); setMetadataUri(null); }} placeholder="https://" /></Field>
          <Field label="X" htmlFor="x"><Input id="x" value={twitter} onChange={(e) => { setTwitter(e.target.value); setMetadataUri(null); }} placeholder="https://x.com/…" /></Field>
          <Field label="Telegram" htmlFor="tg"><Input id="tg" value={telegram} onChange={(e) => { setTelegram(e.target.value); setMetadataUri(null); }} placeholder="https://t.me/…" /></Field>
        </div>
        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <Segmented value={mode} onChange={setMode} options={[{ value: "create", label: "Create only" }, { value: "create_buy", label: "Create and buy" }]} />
            {mode === "create_buy" && <SlippageControl value={slippageBps} onChange={setSlippageBps} />}
          </div>
          {mode === "create_buy" && (
            <Field label="Initial buy" hint="Bought in the same transaction as the create, so nobody can buy before you." error={initialBuy ? buyError : null}>
              <Input value={initialBuy} onChange={(e) => setInitialBuy(e.target.value)} inputMode="decimal" suffix="SOL" />
            </Field>
          )}
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={holderReward} onChange={(e) => setHolderReward(e.target.checked)} className="mt-0.5 accent-[var(--color-glacier)]" />
            <span>
              Holder-reward coin <span className="text-muted">(Pump sends the coin's creator fees to its holders instead of your wallet. Permanent. Only available where Pump has enabled it.)</span>
            </span>
          </label>
        </div>
        <ErrorNote error={error} />
        {!cfg.transactionsEnabled && <ErrorNote error="Launching is disabled on this deployment." />}
        <Button size="lg" disabled={!formValid || !wallet.connected || !cfg.transactionsEnabled} loading={busy === "prepare"} onClick={() => void prepare()}>
          {wallet.connected ? "Review launch" : "Connect a wallet to launch"}
        </Button>
        <p className="text-[13px] text-faint">Images are re-encoded to WebP and stored with the metadata before the token is created.</p>
      </Panel>
    </div>
  );
}
