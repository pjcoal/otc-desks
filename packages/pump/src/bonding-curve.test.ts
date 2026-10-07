import { getBuyTokenAmountFromSolAmount, newBondingCurve, type FeeConfig, type Global } from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { bondingProgressBps, curveSpotPrice, fromBN, quoteCurveBuy, quoteCurveSell, toBN } from "./bonding-curve";

// Representative Global values (mainnet defaults for SOL curves); fee tiers come from FeeConfig = null ⇒ global bps.
const global = {
  initialVirtualTokenReserves: new BN("1073000000000000"),
  initialVirtualSolReserves: new BN("30000000000"),
  initialRealTokenReserves: new BN("793100000000000"),
  tokenTotalSupply: new BN("1000000000000000"),
  feeBasisPoints: new BN(95),
  creatorFeeBasisPoints: new BN(5),
  mayhemModeEnabled: false,
  whitelistedQuoteMints: [],
  initialVirtualQuoteReserves: new BN(0),
  creatorFeeConfigurable: false,
  maxConfigurableCreatorFeeBps: new BN(0),
} as unknown as Global;
const feeConfig: FeeConfig | null = null;

function curve() {
  const c = newBondingCurve(global);
  c.creator = PublicKey.unique();
  return c;
}

describe("bonding curve math", () => {
  it("progress is 0 at launch and 100% when complete", () => {
    expect(bondingProgressBps(793_100_000_000_000n, 793_100_000_000_000n, false)).toBe(0);
    expect(bondingProgressBps(396_550_000_000_000n, 793_100_000_000_000n, false)).toBe(5000);
    expect(bondingProgressBps(0n, 793_100_000_000_000n, true)).toBe(10_000);
  });

  it("spot price from virtual reserves (SOL per whole token)", () => {
    const p = curveSpotPrice({ virtualSolReserves: 30_000_000_000n, virtualTokenReserves: 1_073_000_000_000_000n }, 6);
    // 30 SOL / 1.073B tokens ≈ 2.7959e-8 SOL
    expect(p.toFixed(12)).toBe("0.000000027958"); // 2.79589…e-8, truncated (display rounding never rounds up)
  });

  it("buy quote matches the SDK's own token output and applies slippage with integer bps", () => {
    const c = curve();
    const lamports = 1_000_000_000n;
    const q = quoteCurveBuy({ global, feeConfig, curve: c, mintSupply: 1_000_000_000_000_000n, decimals: 6, slot: 1 }, lamports, 100);
    const sdk = fromBN(getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: toBN(1_000_000_000_000_000n), bondingCurve: c, amount: toBN(lamports), quoteMint: PublicKey.default }));
    expect(q.expectedOutput).toBe(sdk);
    expect(q.minOutput).toBe((sdk * 9_900n) / 10_000n);
    expect(q.maxInput).toBe(lamports);
    expect(q.totalFeeBps).toBe(100);
    expect(q.protocolFeeLamports + q.creatorFeeLamports).toBeGreaterThan(0n);
    expect(q.priceImpactBps).toBeGreaterThan(0);
  });

  it("larger sells have larger price impact", () => {
    const c = curve();
    const ctx = { global, feeConfig, curve: c, mintSupply: 1_000_000_000_000_000n, decimals: 6, slot: 1 };
    const small = quoteCurveSell(ctx, 1_000_000_000n, 100);
    const large = quoteCurveSell(ctx, 100_000_000_000_000n, 100);
    expect(large.priceImpactBps).toBeGreaterThan(small.priceImpactBps);
    expect(large.minOutput).toBeLessThan(large.expectedOutput);
  });
});
