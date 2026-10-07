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
