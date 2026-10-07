"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { parseUnits, SOL_DECIMALS } from "@app/shared";
import type { OrderView } from "@app/otc";
import { useConfig } from "@/components/providers/config";
import { publishOrder } from "@/lib/otc-client";
import { UserRejected } from "@/lib/signing";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";

const EXPIRY = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
  { value: "259200", label: "3 days" },
];

/** A counter is a brand-new signed order for the opposite side, addressed to the other party. */
export function CounterForm({ parent, onDone }: { parent: OrderView; onDone: (o: OrderView) => void }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const d = parent.token.decimals;
  const [qty, setQty] = useState(() => (BigInt(parent.remainingAmountRaw) / 10n ** BigInt(d)).toString());
  const [total, setTotal] = useState("");
  const [ttl, setTtl] = useState("86400");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    let tokenAmountRaw: bigint;
    let quoteAmountRaw: bigint;
    try {
      tokenAmountRaw = parseUnits(qty, d);
      quoteAmountRaw = parseUnits(total, SOL_DECIMALS);
      if (tokenAmountRaw === 0n || quoteAmountRaw === 0n) throw new Error("Amounts must be greater than zero.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy(true);
    try {
      const o = await publishOrder(wallet, cfg, { takerWallet: parent.makerWallet, tokenMint: parent.token.mint, tokenProgram: parent.tokenProgram, tokenDecimals: d, side: parent.side === "SELL" ? "BUY" : "SELL", tokenAmountRaw, quoteAmountRaw, ttlSeconds: Number(ttl), allowPartialFill: false }, parent);
      toast.success("Counteroffer sent", "The other party can accept or counter again.");
      onDone(o);
    } catch (e) {
      if (e instanceof UserRejected) toast.info("Cancelled", e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantity" htmlFor="c-qty">
          <Input id="c-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" suffix={parent.token.symbol} />
        </Field>
        <Field label="Total price" htmlFor="c-total">
          <Input id="c-total" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="0.0" suffix="SOL" />
        </Field>
      </div>
      <Field label="Counter expires in">
        <Segmented value={ttl} onChange={setTtl} options={EXPIRY} />
      </Field>
      <ErrorNote error={error} />
      <Button onClick={() => void submit()} loading={busy}>Sign and send counteroffer</Button>
    </div>
  );
}
