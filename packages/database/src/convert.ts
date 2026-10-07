import { Prisma } from "./generated/client";

/** bigint → Prisma Decimal for NUMERIC(40,0) columns. */
export const dec = (v: bigint | string): Prisma.Decimal => new Prisma.Decimal(v.toString());

/** Prisma Decimal (integer-valued) → bigint. Throws if the stored value is fractional. */
export function big(v: Prisma.Decimal | { toFixed(): string } | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;
  const s = v.toFixed();
  if (!/^-?\d+$/.test(s)) throw new Error(`Expected integer NUMERIC, got ${s}`);
  return BigInt(s);
}
