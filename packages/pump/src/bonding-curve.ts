import {
  bondingCurveMarketCap,
  canonicalPumpPoolPda,
  computeFeesBps,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
  type BondingCurve,
  type FeeConfig,
  type Global,
} from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { BPS_DENOMINATOR, D, mulDivCeil, mulDivFloor, unitPrice, SOL_DECIMALS } from "@app/shared";
import { PUMP_EXPECTED_SUPPLY_RAW, SOL_QUOTE } from "./constants";
import type { BondingCurveState, TradeQuote } from "./types";

export const toBN = (v: bigint): BN => new BN(v.toString());
export const fromBN = (v: BN): bigint => BigInt(v.toString());

export function isSolQuoted(quoteMint: PublicKey): boolean {
  // SOL curves store the zero key; v2 instructions use WSOL. Both mean SOL.
  return quoteMint.equals(PublicKey.default) || quoteMint.toBase58() === "So11111111111111111111111111111111111111112";
}

export function toCurveState(address: PublicKey, c: BondingCurve): BondingCurveState {
  return {
    address: address.toBase58(),
    virtualSolReserves: fromBN(c.virtualQuoteReserves),
    virtualTokenReserves: fromBN(c.virtualTokenReserves),
    realSolReserves: fromBN(c.realQuoteReserves),
    realTokenReserves: fromBN(c.realTokenReserves),
    tokenTotalSupply: fromBN(c.tokenTotalSupply),
    complete: c.complete,
    creator: c.creator.toBase58(),
    isMayhemMode: c.isMayhemMode,
    isHolderReward: c.isHolderReward,
    isCashbackCoin: c.isCashbackCoin,
    quoteMint: isSolQuoted(c.quoteMint) ? SOL_QUOTE : c.quoteMint.toBase58(),
    creatorFeeBps: Number(c.creatorFeeBps.toString()),
  };
}

/** Graduation progress: share of the initial real token reserves already sold, in bps. */
export function bondingProgressBps(realTokenReserves: bigint, initialRealTokenReserves: bigint, complete: boolean): number {
  if (complete) return 10_000;
  if (initialRealTokenReserves <= 0n) return 0;
  const sold = initialRealTokenReserves > realTokenReserves ? initialRealTokenReserves - realTokenReserves : 0n;
  const bps = mulDivFloor(sold, BPS_DENOMINATOR, initialRealTokenReserves);
  return Number(bps > BPS_DENOMINATOR ? BPS_DENOMINATOR : bps);
}

/** Spot price in SOL per whole token from virtual reserves. */
export function curveSpotPrice(s: Pick<BondingCurveState, "virtualSolReserves" | "virtualTokenReserves">, decimals: number) {
  if (s.virtualTokenReserves === 0n) return new D(0);
  return unitPrice(s.virtualSolReserves, SOL_DECIMALS, s.virtualTokenReserves, decimals).toSignificantDigits(18, D.ROUND_DOWN);
}

export function curveMarketCapLamports(c: BondingCurve): bigint {
  if (c.virtualTokenReserves.isZero()) return 0n;
  return fromBN(bondingCurveMarketCap({ mintSupply: c.tokenTotalSupply, virtualQuoteReserves: c.virtualQuoteReserves, virtualTokenReserves: c.virtualTokenReserves }));
}

function impactBps(spot: InstanceType<typeof D>, exec: InstanceType<typeof D>, side: "BUY" | "SELL"): number {
  if (spot.isZero()) return 0;
  const ratio = side === "BUY" ? exec.div(spot).sub(1) : spot.sub(exec).div(spot);
  return Math.max(0, Number(ratio.mul(10_000).toFixed(0, D.ROUND_HALF_UP)));
}

function applySlippageDown(v: bigint, slippageBps: number): bigint {
  return mulDivFloor(v, BPS_DENOMINATOR - BigInt(slippageBps), BPS_DENOMINATOR);
}

export interface CurveContext {
  global: Global;
  feeConfig: FeeConfig | null;
  curve: BondingCurve;
  mintSupply: bigint;
  decimals: number;
  slot: number;
}

function feesBps(ctx: CurveContext) {
  const { protocolFeeBps, creatorFeeBps } = computeFeesBps({
    global: ctx.global,
    feeConfig: ctx.feeConfig,
    // Mirrors the SDK's getFee: non-mayhem coins are tiered on the fixed 1B supply.
    mintSupply: toBN(ctx.curve.isMayhemMode ? ctx.mintSupply : PUMP_EXPECTED_SUPPLY_RAW),
    virtualQuoteReserves: ctx.curve.virtualQuoteReserves,
    virtualTokenReserves: ctx.curve.virtualTokenReserves,
    quoteMint: ctx.curve.quoteMint,
    creatorFeeBps: ctx.curve.creatorFeeBps,
  });
  const creatorApplies = !ctx.curve.creator.equals(PublicKey.default);
  return { protocol: BigInt(protocolFeeBps.toString()), creator: creatorApplies ? BigInt(creatorFeeBps.toString()) : 0n };
}

/**
 * Exact-SOL-in buy quote on the bonding curve (route: buy_exact_quote_in_v2).
 * Uses the SDK's curve math so results match the program's own rounding.
 */
export function quoteCurveBuy(ctx: CurveContext, lamportsIn: bigint, slippageBps: number): TradeQuote {
  const tokensOut = fromBN(
    getBuyTokenAmountFromSolAmount({
      global: ctx.global,
      feeConfig: ctx.feeConfig,
      mintSupply: toBN(ctx.mintSupply),
      bondingCurve: ctx.curve,
      amount: toBN(lamportsIn),
      quoteMint: ctx.curve.quoteMint,
    }),
  );
  const f = feesBps(ctx);
  const totalBps = f.protocol + f.creator;
  // The program deducts fees from the spendable input: net = in * 10000 / (10000 + fees).
  const net = mulDivFloor(lamportsIn, BPS_DENOMINATOR, BPS_DENOMINATOR + totalBps);
  const totalFee = lamportsIn - net;
  const protocolFee = totalBps === 0n ? 0n : mulDivFloor(totalFee, f.protocol, totalBps);
  const state = toCurveState(PublicKey.default, ctx.curve);
  const spot = curveSpotPrice(state, ctx.decimals);
  const exec = tokensOut === 0n ? new D(0) : unitPrice(lamportsIn, SOL_DECIMALS, tokensOut, ctx.decimals).toSignificantDigits(18, D.ROUND_DOWN);
  return {
    side: "BUY",
    venue: "PUMP_BONDING_CURVE",
    route: "Pump bonding curve (buy_exact_quote_in_v2)",
    mint: "",
    decimals: ctx.decimals,
    inputAmount: lamportsIn,
    expectedOutput: tokensOut,
    minOutput: applySlippageDown(tokensOut, slippageBps),
    maxInput: lamportsIn,
    protocolFeeLamports: protocolFee,
    creatorFeeLamports: totalFee - protocolFee,
    lpFeeLamports: 0n,
    totalFeeBps: Number(totalBps),
    priceImpactBps: impactBps(spot, exec, "BUY"),
    spotPriceSolPerToken: spot.toFixed(),
    executionPriceSolPerToken: exec.toFixed(),
    slippageBps,
    slot: ctx.slot,
    quotedAt: new Date().toISOString(),
  };
}

/** Exact-token-in sell quote on the bonding curve (route: sell_v2). */
export function quoteCurveSell(ctx: CurveContext, tokensIn: bigint, slippageBps: number): TradeQuote {
  const solOut = fromBN(
    getSellSolAmountFromTokenAmount({
      global: ctx.global,
      feeConfig: ctx.feeConfig,
      mintSupply: toBN(ctx.mintSupply),
      bondingCurve: ctx.curve,
      amount: toBN(tokensIn),
    }),
  );
  const f = feesBps(ctx);
  const totalBps = f.protocol + f.creator;
  // Gross curve output before fees, same formula as the SDK: in * vSol / (vTok + in).
  const vSol = fromBN(ctx.curve.virtualQuoteReserves);
  const vTok = fromBN(ctx.curve.virtualTokenReserves);
  const gross = tokensIn === 0n ? 0n : mulDivFloor(tokensIn, vSol, vTok + tokensIn);
  const totalFee = gross > solOut ? gross - solOut : 0n;
  const protocolFee = totalFee === 0n ? 0n : BigIntMin(totalFee, mulDivCeil(gross, f.protocol, BPS_DENOMINATOR));
  const state = toCurveState(PublicKey.default, ctx.curve);
  const spot = curveSpotPrice(state, ctx.decimals);
  const exec = tokensIn === 0n ? new D(0) : unitPrice(solOut, SOL_DECIMALS, tokensIn, ctx.decimals).toSignificantDigits(18, D.ROUND_DOWN);
  return {
    side: "SELL",
    venue: "PUMP_BONDING_CURVE",
    route: "Pump bonding curve (sell_v2)",
    mint: "",
    decimals: ctx.decimals,
    inputAmount: tokensIn,
    expectedOutput: solOut,
    minOutput: applySlippageDown(solOut, slippageBps),
    maxInput: tokensIn,
    protocolFeeLamports: protocolFee,
    creatorFeeLamports: totalFee - protocolFee,
    lpFeeLamports: 0n,
    totalFeeBps: Number(totalBps),
    priceImpactBps: impactBps(spot, exec, "SELL"),
    spotPriceSolPerToken: spot.toFixed(),
    executionPriceSolPerToken: exec.toFixed(),
    slippageBps,
    slot: ctx.slot,
    quotedAt: new Date().toISOString(),
  };
}

function BigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export { impactBps, applySlippageDown };

/** True when `pool` is the canonical PumpSwap pool a graduated Pump coin migrates to (SOL quote). */
export function isCanonicalPumpPool(pool: string, baseMint: string): boolean {
  return canonicalPumpPoolPda(new PublicKey(baseMint)).toBase58() === pool;
}
