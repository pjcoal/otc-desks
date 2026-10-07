"use client";
import { useQuery } from "@tanstack/react-query";
import { D } from "@app/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatUsd, lamportsToUsd } from "@/lib/format";
import { Sol } from "@/components/ui/amount";

/** Pyth SOL/USD from our API. `solUsd` is null off mainnet (test-cluster SOL has no USD value). */
export function useSolUsd(): { solUsd: string | null; loading: boolean } {
  const q = useQuery({ queryKey: ["sol-usd"], queryFn: () => api<{ solUsd: string | null }>("/api/prices/sol-usd"), staleTime: 30_000, refetchInterval: 60_000 });
  return { solUsd: q.data?.solUsd ?? null, loading: q.isPending };
}

/**
 * A SOL-denominated figure shown in USD. Pass `usd` when a USD figure is already known (e.g. 24h
 * volume from the listing-stats source). Falls back to SOL when no SOL/USD price is available.
 */
export function Usd({ lamports, usd, digits = 2, className }: { lamports?: string | bigint | null; usd?: string | null; digits?: number; className?: string }) {
  const { solUsd, loading } = useSolUsd();
  if (usd !== null && usd !== undefined) return <span className={cn("num", className)}>{formatUsd(new D(usd))}</span>;
  if (lamports === null || lamports === undefined) return <span className={cn("num text-faint", className)}>—</span>;
  if (loading) return <span className={cn("num text-faint", className)}>…</span>;
  if (!solUsd) return <Sol lamports={lamports} digits={digits} className={className} />;
  return (
    <span className={cn("num", className)} title={`At $${new D(solUsd).toFixed(2)} per SOL (Pyth)`}>
      {formatUsd(lamportsToUsd(lamports, solUsd))}
    </span>
  );
}
