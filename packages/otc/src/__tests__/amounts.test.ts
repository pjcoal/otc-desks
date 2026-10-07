import { describe, expect, it } from "vitest";
import { checkFill, computeSettlementAmounts, cumulativeQuote, effectiveFeeBps, orderUnitPrice, premiumVsMarket, quoteForFill } from "../amounts";
import { D } from "@app/shared";

describe("fee calculations", () => {
  const base = { grossQuote: 20_000_000_000n, feeBps: 50, referralShareBps: 0, hasReferrer: false };
  it("SELLER_PAYS: 20 SOL gross → 0.1 SOL fee, seller nets 19.9", () => {
    const r = computeSettlementAmounts({ ...base, feeMode: "SELLER_PAYS" });
    expect(r).toMatchObject({ totalFee: 100_000_000n, buyerPays: 20_000_000_000n, sellerReceives: 19_900_000_000n, platformFee: 100_000_000n, referralFee: 0n });
  });
  it("BUYER_PAYS", () => {
    const r = computeSettlementAmounts({ ...base, feeMode: "BUYER_PAYS" });
    expect(r).toMatchObject({ buyerPays: 20_100_000_000n, sellerReceives: 20_000_000_000n });
  });
  it("SPLIT with odd fee rounds the extra lamport to the seller's share", () => {
    const r = computeSettlementAmounts({ grossQuote: 1_000_000_002n, feeBps: 1, feeMode: "SPLIT", referralShareBps: 0, hasReferrer: false });
    expect(r.totalFee).toBe(100_000n);
    const odd = computeSettlementAmounts({ grossQuote: 30_000n, feeBps: 1, feeMode: "SPLIT", referralShareBps: 0, hasReferrer: false });
    expect(odd.totalFee).toBe(3n);
    expect(odd.buyerPays - odd.grossQuote).toBe(1n);
    expect(odd.grossQuote - odd.sellerReceives).toBe(2n);
  });
  it("referral share comes out of the platform fee, never on top", () => {
    const r = computeSettlementAmounts({ ...base, feeMode: "SELLER_PAYS", referralShareBps: 2000, hasReferrer: true });
    expect(r.referralFee).toBe(20_000_000n);
    expect(r.platformFee).toBe(80_000_000n);
    expect(r.platformFee + r.referralFee).toBe(r.totalFee);
  });
  it("conservation invariant holds across random inputs", () => {
    for (let i = 0; i < 500; i++) {
      const gross = BigInt(Math.floor(Math.random() * 1e12)) + 1n;
      const feeBps = Math.floor(Math.random() * 1001);
      for (const feeMode of ["SELLER_PAYS", "BUYER_PAYS", "SPLIT"] as const) {
        const r = computeSettlementAmounts({ grossQuote: gross, feeBps, feeMode, referralShareBps: Math.floor(Math.random() * 10_001), hasReferrer: true });
        expect(r.buyerPays).toBe(r.sellerReceives + r.platformFee + r.referralFee);
        expect(r.totalFee).toBeLessThanOrEqual((gross * BigInt(feeBps)) / 10_000n);
      }
    }
  });
  it("effective fee never exceeds the signed fee", () => {
    expect(effectiveFeeBps(50, 100)).toBe(50);
    expect(effectiveFeeBps(50, 25)).toBe(25);
  });
});

describe("partial fills", () => {
  const order = { side: "SELL" as const, tokenAmountRaw: 3n, quoteAmountRaw: 10n };
  it("cumulative quotes sum exactly to the signed total (no drift)", () => {
    const parts = [quoteForFill(order, 0n, 1n), quoteForFill(order, 1n, 1n), quoteForFill(order, 2n, 1n)];
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(10n);
    expect(parts[0]).toBe(4n); // ceil in favour of the selling maker
  });
  it("buying maker pays floor", () => {
    expect(cumulativeQuote("BUY", 3n, 10n, 1n)).toBe(3n);
  });
  it("fill validation", () => {
    const o = { allowPartialFill: true, tokenAmountRaw: 100n, minimumFillAmountRaw: 10n };
    expect(checkFill(o, 0n, 5n)).toMatchObject({ ok: false, code: "FILL_TOO_SMALL" });
    expect(checkFill(o, 0n, 10n).ok).toBe(true);
    expect(checkFill(o, 95n, 5n).ok).toBe(true); // final remainder
    expect(checkFill(o, 95n, 6n)).toMatchObject({ ok: false, code: "FILL_TOO_LARGE" });
    expect(checkFill({ ...o, allowPartialFill: false, minimumFillAmountRaw: 100n }, 0n, 50n).ok).toBe(false);
  });
});

describe("pricing", () => {
  it("price per token and premium/discount", () => {
    const otc = orderUnitPrice(19_000_000_000n, 5_000_000_000_000n, 6); // 19 SOL / 5M tokens
    expect(otc.toFixed()).toBe("0.0000038");
    const pct = premiumVsMarket(otc, new D("0.0000042"))!;
    expect(pct.toFixed(2)).toBe("-9.52");
    expect(premiumVsMarket(otc, null)).toBeNull();
  });
});
