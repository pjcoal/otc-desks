"use client";
import { useConfig } from "@/components/providers/config";
import { cn } from "@/lib/cn";

/** Always visible in the tray. Mainnet without ALLOW_MAINNET is labelled read-only. */
export function NetworkBadge() {
  const c = useConfig();
  const label = c.cluster === "mainnet-beta" ? "Mainnet" : c.cluster[0]!.toUpperCase() + c.cluster.slice(1);
  return (
    <span title={c.transactionsEnabled ? `Connected to Solana ${label}` : "Transactions are disabled on this deployment"} className="inline-flex items-center gap-1.5 text-[13px]">
      <span className={cn("size-2.5 border border-text", c.isMainnet ? (c.transactionsEnabled ? "bg-buy" : "bg-sell") : "bg-[#e8c25a]")} aria-hidden />
      {label}
      {!c.transactionsEnabled && <span className="text-sell">(read-only)</span>}
    </span>
  );
}
