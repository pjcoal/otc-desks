import { D, formatCompact, formatPct, formatPrice, formatSol, formatUnits, shortAddress, type Dec } from "@app/shared";

export { formatCompact, formatPct, formatPrice, formatSol, formatUnits, shortAddress };

export const sol = (lamports: string | bigint | null | undefined, digits = 4) => (lamports === null || lamports === undefined ? "—" : formatSol(BigInt(lamports), digits));
export const tokens = (raw: string | bigint | null | undefined, decimals: number, digits = 2) =>
  raw === null || raw === undefined ? "—" : formatUnits(BigInt(raw), decimals, { group: true, maxFractionDigits: digits });
export const compactTokens = (raw: string | bigint, decimals: number) => formatCompact(BigInt(raw), decimals);
export const price = (p: string | null | undefined) => (p ? formatPrice(new D(p), 4) : "—");
export const pct = (p: string | Dec | null | undefined) => (p === null || p === undefined ? "—" : formatPct(typeof p === "string" ? new D(p) : p));
export const bps = (b: number) => `${(b / 100).toFixed(b % 100 === 0 ? 0 : 2)}%`;

export function timeLeft(iso: string, now = Date.now()): string {
  const s = Math.floor((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return "expired";
  if (s < 3600) return `${Math.ceil(s / 60)}m left`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left`;
  return `${Math.floor(s / 86400)}d left`;
}

/** "$1.24M", "$512.3K", "$84.20". Display only (USD figures never feed into trade amounts). */
export function formatUsd(value: Dec): string {
  const v = value.abs();
  const sign = value.isNeg() ? "-" : "";
  if (v.gte(1e9)) return `${sign}$${v.div(1e9).toFixed(2, D.ROUND_DOWN)}B`;
  if (v.gte(1e6)) return `${sign}$${v.div(1e6).toFixed(2, D.ROUND_DOWN)}M`;
  if (v.gte(1e3)) return `${sign}$${v.div(1e3).toFixed(1, D.ROUND_DOWN)}K`;
  return `${sign}$${v.toFixed(2, D.ROUND_DOWN)}`;
}

/** Lamports → USD at the given SOL/USD price. */
export const lamportsToUsd = (lamports: string | bigint, solUsd: string): Dec => new D(lamports.toString()).div(1e9).mul(solUsd);
