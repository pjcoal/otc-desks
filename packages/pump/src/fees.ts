/**
 * FeeService: one place that explains every fee a user pays, by destination. It reports only fees
 * the current Pump protocol actually charges (read from chain via the SDK's schedule) plus our own
 * disclosed OTC fee. Nothing here invents protocol capabilities.
 */
import type { MarketSnapshot, TradeQuote } from "./types";

export type FeeDestination = "PROTOCOL" | "CREATOR" | "HOLDER_REWARD" | "LP" | "PLATFORM" | "REFERRER";

export interface FeeLine {
  destination: FeeDestination;
  label: string;
  lamports: bigint;
  /** Basis points when the fee is a rate; null for fixed amounts. */
  bps: number | null;
}

export function pumpTradeFees(market: MarketSnapshot, quote: TradeQuote): FeeLine[] {
  const lines: FeeLine[] = [];
  const venue = quote.venue === "PUMPSWAP" ? "PumpSwap" : "Pump";
  if (quote.protocolFeeLamports > 0n) lines.push({ destination: "PROTOCOL", label: `${venue} protocol fee`, lamports: quote.protocolFeeLamports, bps: null });
  if (quote.creatorFeeLamports > 0n) {
    const holderReward = market.bondingCurve?.isHolderReward ?? false;
    lines.push({
      destination: holderReward ? "HOLDER_REWARD" : "CREATOR",
      label: holderReward ? "Creator fee (paid to holders: holder-reward coin)" : "Coin creator fee",
      lamports: quote.creatorFeeLamports,
      bps: null,
    });
  }
  if (quote.lpFeeLamports > 0n) lines.push({ destination: "LP", label: "PumpSwap LP fee", lamports: quote.lpFeeLamports, bps: null });
  return lines;
}

export function totalFees(lines: FeeLine[]): bigint {
  return lines.reduce((sum, l) => sum + l.lamports, 0n);
}
