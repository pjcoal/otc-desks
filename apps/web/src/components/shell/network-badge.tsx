"use client";
import { useConfig } from "@/components/providers/config";
import { cn } from "@/lib/cn";

/** Always visible in the tray: which Solana network this deployment uses. */
export function NetworkBadge() {
  const c = useConfig();
  const label = c.cluster === "mainnet-beta" ? "Mainnet" : c.cluster[0]!.toUpperCase() + c.cluster.slice(1);
  return (
    <span title={`Solana ${label}`} className="inline-flex items-center gap-1.5 text-[13px]">
      <span className={cn("size-2.5 border border-text", c.isMainnet ? "bg-buy" : "bg-[#e8c25a]")} aria-hidden />
      {label}
    </span>
  );
}
