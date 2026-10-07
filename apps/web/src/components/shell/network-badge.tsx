"use client";
import { useConfig } from "@/components/providers/config";
import { cn } from "@/lib/cn";

/** Always visible. Mainnet without ALLOW_MAINNET is shown as read-only. */
export function NetworkBadge() {
  const c = useConfig();
  const label = c.cluster === "mainnet-beta" ? "Mainnet" : c.cluster[0]!.toUpperCase() + c.cluster.slice(1);
  return (
    <span
      title={c.transactionsEnabled ? `Connected to Solana ${label}` : "Transactions are disabled on this deployment"}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium",
        c.isMainnet ? (c.transactionsEnabled ? "border-buy/40 text-buy" : "border-sell/50 text-sell") : "border-warn/50 bg-warn-dim/50 text-warn",
      )}
    >
      <span className={cn("size-1.5 rounded-full", c.isMainnet ? (c.transactionsEnabled ? "bg-buy" : "bg-sell") : "bg-warn")} />
      {label}
      {!c.transactionsEnabled && " (read-only)"}
    </span>
  );
}
