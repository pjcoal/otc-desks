/**
 * Numeric safety layer.
 *
 * Every on-chain quantity (lamports, raw token units) is a `bigint`. Ratios and display values use
 * `Decimal` with high precision. JavaScript `number` is never used for token or SOL accounting;
 * the only `number` inputs accepted here are small integers such as mint decimals and basis points.
 */
import Decimal from "decimal.js";

export const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN, toExpNeg: -40, toExpPos: 60 });
export type Dec = InstanceType<typeof D>;

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BPS_DENOMINATOR = 10_000n;
/** u64::MAX — the upper bound of every SPL/Token-2022 amount and lamport balance. */
export const U64_MAX = 18_446_744_073_709_551_615n;

export class NumericError extends Error {
  override name = "NumericError";
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new NumericError(`Invalid decimals: ${decimals}`);
  }
}

export function assertU64(value: bigint, label = "amount"): bigint {
  if (value < 0n || value > U64_MAX) throw new NumericError(`${label} is outside the u64 range`);
  return value;
}

const DECIMAL_STRING = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a human decimal string ("12.5") into raw base units. Rejects exponents, signs, separators and
 * more fractional digits than the mint supports (never silently rounds user input).
 */
export function parseUnits(input: string, decimals: number): bigint {
  assertDecimals(decimals);
  const trimmed = input.trim();
  const match = DECIMAL_STRING.exec(trimmed);
  if (!match) throw new NumericError("Enter a plain positive number, e.g. 1.25");
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new NumericError(`At most ${decimals} decimal places are supported`);
  }
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return assertU64(raw);
}

export interface FormatOptions {
  /** Truncate (never round up) to at most this many fractional digits. */
  maxFractionDigits?: number;
  /** Insert thousands separators in the whole part. */
  group?: boolean;
}

/** Format raw base units as a decimal string. Truncates toward zero; never rounds up. */
export function formatUnits(raw: bigint, decimals: number, opts: FormatOptions = {}): string {
  assertDecimals(decimals);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = decimals > 0 ? (abs % base).toString().padStart(decimals, "0") : "";
  if (opts.maxFractionDigits !== undefined) fraction = fraction.slice(0, opts.maxFractionDigits);
  fraction = fraction.replace(/0+$/, "");
  const wholeStr = opts.group ? groupThousands(whole.toString()) : whole.toString();
  const body = fraction.length > 0 ? `${wholeStr}.${fraction}` : wholeStr;
  return negative && body !== "0" ? `-${body}` : body;
}

export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const solToLamports = (sol: string): bigint => parseUnits(sol, SOL_DECIMALS);
export const formatSol = (lamports: bigint, maxFractionDigits = 9): string =>
  formatUnits(lamports, SOL_DECIMALS, { maxFractionDigits, group: true });

/** floor(a * b / d) using exact integer arithmetic. */
export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new NumericError("Division by zero");
  if (a < 0n || b < 0n || d < 0n) throw new NumericError("mulDiv expects non-negative operands");
  return (a * b) / d;
}

/** ceil(a * b / d) using exact integer arithmetic. */
export function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new NumericError("Division by zero");
  if (a < 0n || b < 0n || d < 0n) throw new NumericError("mulDiv expects non-negative operands");
  const product = a * b;
  return product === 0n ? 0n : (product - 1n) / d + 1n;
}

/** floor(amount * bps / 10_000). */
export function bpsOf(amount: bigint, bps: number | bigint): bigint {
  const b = BigInt(bps);
  if (b < 0n || b > BPS_DENOMINATOR) throw new NumericError(`Invalid basis points: ${bps}`);
  return mulDivFloor(amount, b, BPS_DENOMINATOR);
}

/**
 * Price of one whole token expressed in whole quote units (e.g. SOL per token).
 * price = (quoteRaw / 10^quoteDecimals) / (tokenRaw / 10^tokenDecimals)
 */
export function unitPrice(
  quoteRaw: bigint,
  quoteDecimals: number,
  tokenRaw: bigint,
  tokenDecimals: number,
): Dec {
  assertDecimals(quoteDecimals);
  assertDecimals(tokenDecimals);
  if (tokenRaw === 0n) throw new NumericError("Token amount must be positive to compute a price");
  return new D(quoteRaw.toString())
    .mul(new D(10).pow(tokenDecimals))
    .div(new D(tokenRaw.toString()).mul(new D(10).pow(quoteDecimals)));
}

/** (otcPrice - marketPrice) / marketPrice * 100 */
export function premiumDiscountPct(otcPrice: Dec, marketPrice: Dec): Dec {
  if (marketPrice.isZero()) throw new NumericError("Market price is zero");
  return otcPrice.sub(marketPrice).div(marketPrice).mul(100);
}

/** Convert a Decimal to a fixed string for Postgres NUMERIC columns (no exponent). */
export function decimalToDbString(value: Dec, fractionDigits = 18): string {
  return value.toFixed(fractionDigits, D.ROUND_DOWN);
}

/** Accepts a bigint, a decimal integer string, or anything with `toString()` that yields one (BN, Prisma.Decimal). */
export function toBigInt(value: bigint | string | { toString(): string }): bigint {
  if (typeof value === "bigint") return value;
  const s = typeof value === "string" ? value : value.toString();
  if (!/^-?\d+$/.test(s)) throw new NumericError(`Not an integer: ${s}`);
  return BigInt(s);
}

/** Compact display for large token quantities (e.g. 20M). Display only — never use for accounting. */
export function formatCompact(raw: bigint, decimals: number): string {
  const value = new D(raw.toString()).div(new D(10).pow(decimals));
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [threshold, suffix] of units) {
    if (value.gte(threshold)) return `${trimDecimal(value.div(threshold).toFixed(2, D.ROUND_DOWN))}${suffix}`;
  }
  return trimDecimal(value.toFixed(value.lt(1) ? 6 : 2, D.ROUND_DOWN));
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Display a Decimal price. Very small prices use subscript-zero notation (0.0₉93 = 0.00000000093) so
 * the significant digits stay visible. Display only.
 */
export function formatPrice(value: Dec, significant = 4): string {
  if (value.isZero()) return "0";
  if (value.gte(1)) return trimDecimal(value.toFixed(Math.max(2, significant - value.trunc().toString().length), D.ROUND_DOWN));
  const fixed = value.toSignificantDigits(significant, D.ROUND_DOWN).toFixed();
  const m = /^0\.(0+)(\d+)$/.exec(fixed);
  if (m && m[1]!.length >= 4) {
    const zeros = String(m[1]!.length).split("").map((d) => SUBSCRIPT[Number(d)]).join("");
    return `0.0${zeros}${m[2]!.replace(/0+$/, "")}`;
  }
  return trimDecimal(fixed);
}

export function formatPct(value: Dec, fractionDigits = 2): string {
  const s = value.toFixed(fractionDigits, D.ROUND_HALF_EVEN);
  return value.gt(0) ? `+${s}%` : `${s}%`;
}

function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
