import { describe, expect, it } from "vitest";
import { D, LAMPORTS_PER_SOL, bpsOf, formatPrice, formatSol, formatUnits, mulDivCeil, mulDivFloor, parseUnits, premiumDiscountPct, solToLamports, unitPrice } from "./numeric";

describe("SOL / lamport conversions", () => {
  it("1 SOL = 1,000,000,000 lamports exactly", () => {
    expect(solToLamports("1")).toBe(LAMPORTS_PER_SOL);
    expect(solToLamports("0.000000001")).toBe(1n);
    expect(solToLamports("20")).toBe(20_000_000_000n);
    expect(formatSol(19_900_000_000n)).toBe("19.9");
  });
  it("avoids binary floating point (0.1 + 0.2 class bugs)", () => {
    expect(solToLamports("0.1") + solToLamports("0.2")).toBe(solToLamports("0.3"));
    expect(parseUnits("123456789.123456789", 9)).toBe(123_456_789_123_456_789n);
  });
  it("rejects ambiguous or lossy input instead of rounding", () => {
    for (const bad of ["", "1e9", "-1", "1,000", "0x10", "1.0000000001", " . ", "NaN"]) expect(() => parseUnits(bad, 9)).toThrow();
    expect(() => parseUnits("18446744073709.551616", 6)).toThrow(); // > u64
  });
});

describe("token decimal conversions", () => {
  it("handles 0, 6 and 9 decimals", () => {
    expect(parseUnits("5000000", 6)).toBe(5_000_000_000_000n);
    expect(formatUnits(5_000_000_000_000n, 6, { group: true })).toBe("5,000,000");
    expect(parseUnits("42", 0)).toBe(42n);
    expect(formatUnits(1n, 6)).toBe("0.000001");
    expect(formatUnits(1_234_567n, 6, { maxFractionDigits: 2 })).toBe("1.23");
  });
  it("display formatting truncates, never rounds up", () => {
    expect(formatUnits(1_999_999n, 6, { maxFractionDigits: 2 })).toBe("1.99");
  });
});

describe("integer arithmetic", () => {
  it("mulDiv floor / ceil", () => {
    expect(mulDivFloor(10n, 1n, 3n)).toBe(3n);
    expect(mulDivCeil(10n, 1n, 3n)).toBe(4n);
    expect(mulDivCeil(9n, 1n, 3n)).toBe(3n);
    expect(() => mulDivFloor(1n, 1n, 0n)).toThrow();
  });
  it("basis points", () => {
    expect(bpsOf(20_000_000_000n, 50)).toBe(100_000_000n);
    expect(bpsOf(199n, 50)).toBe(0n);
    expect(() => bpsOf(1n, 10_001)).toThrow();
  });
});

describe("prices and premium/discount", () => {
  it("unit price and premium", () => {
    const otc = unitPrice(19_000_000_000n, 9, 5_000_000_000_000n, 6);
    expect(otc.toFixed()).toBe("0.0000038");
    expect(premiumDiscountPct(otc, new D("0.0000042")).toFixed(2)).toBe("-9.52");
    expect(premiumDiscountPct(new D("0.0000044"), new D("0.0000040")).toFixed(2)).toBe("10.00");
    expect(() => premiumDiscountPct(otc, new D(0))).toThrow();
  });
  it("formats tiny prices with subscript zeros", () => {
    expect(formatPrice(new D("0.00000000093196"))).toBe("0.0₉9319");
    expect(formatPrice(new D("0.0042"))).toBe("0.0042");
    expect(formatPrice(new D("12.3456"))).toBe("12.34");
  });
});
