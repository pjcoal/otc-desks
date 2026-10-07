import {
  OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
  buyQuoteInput,
  computeFeesBps as ammComputeFeesBps,
  poolMarketCap,
  sellBaseInput,
  type FeeConfig as AmmFeeConfig,
  type GlobalConfig,
  type Pool,
} from "@pump-fun/pump-swap-sdk";
import { MintLayout, type RawMint } from "@solana/spl-token";
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { D, SOL_DECIMALS, mulDivFloor, unitPrice, BPS_DENOMINATOR } from "@app/shared";
import { SOL_QUOTE } from "./constants";
import { fromBN, impactBps, isSolQuoted, toBN } from "./bonding-curve";
import type { PoolState, TradeQuote } from "./types";

export function toPoolState(address: PublicKey, pool: Pool, baseReserve: bigint, quoteReserve: bigint): PoolState {
  const virtualQuoteReserves = fromBN(pool.virtualQuoteReserves);
  return {
    address: address.toBase58(),
    baseReserve,
    quoteReserve,
    virtualQuoteReserves,
    effectiveQuoteReserve: quoteReserve + virtualQuoteReserves,
    lpSupply: fromBN(pool.lpSupply),
    creator: pool.creator.toBase58(),
    coinCreator: pool.coinCreator.toBase58(),
    quoteMint: isSolQuoted(pool.quoteMint) ? SOL_QUOTE : pool.quoteMint.toBase58(),
    isMayhemMode: pool.isMayhemMode,
  };
}

export function poolSpotPrice(p: PoolState, decimals: number) {
  if (p.baseReserve === 0n || p.effectiveQuoteReserve <= 0n) return new D(0);
  return unitPrice(p.effectiveQuoteReserve, SOL_DECIMALS, p.baseReserve, decimals).toSignificantDigits(18, D.ROUND_DOWN);
}

export function poolMarketCapLamports(p: PoolState, supply: bigint): bigint {
  if (p.baseReserve === 0n || p.effectiveQuoteReserve <= 0n) return 0n;
  return fromBN(poolMarketCap({ baseMintSupply: toBN(supply), baseReserve: toBN(p.baseReserve), quoteReserve: toBN(p.effectiveQuoteReserve), isMayhemMode: p.isMayhemMode }));
}

export interface PoolContext {
  poolKey: PublicKey;
  pool: Pool;
  state: PoolState;
  globalConfig: GlobalConfig;
  feeConfig: AmmFeeConfig | null;
  baseMint: PublicKey;
  baseMintAccount: RawMint;
  decimals: number;
  supply: bigint;
  slot: number;
}

export function decodeRawMint(data: Buffer): RawMint {
  return MintLayout.decode(data.subarray(0, MintLayout.span));
}

/** The SDK takes slippage as a percentage `number`; convert from integer bps at this boundary only. */
const pct = (bps: number) => bps / 100;

function poolArgs(ctx: PoolContext) {
  return {
    baseReserve: toBN(ctx.state.baseReserve),
    quoteReserve: toBN(ctx.state.quoteReserve),
    virtualQuoteReserves: ctx.pool.virtualQuoteReserves,
    globalConfig: ctx.globalConfig,
    feeConfig: ctx.feeConfig,
    baseMint: ctx.baseMint,
    baseMintAccount: ctx.baseMintAccount,
    coinCreator: ctx.pool.coinCreator,
    creator: ctx.pool.creator,
    quoteMint: ctx.pool.quoteMint,
    isMayhemMode: ctx.pool.isMayhemMode,
    creatorFeeBps: ctx.pool.creatorFeeBps,
  };
}

function ammFees(ctx: PoolContext) {
  const f = ammComputeFeesBps({
    globalConfig: ctx.globalConfig,
    feeConfig: ctx.feeConfig,
    creator: ctx.pool.coinCreator,
    baseMintSupply: toBN(ctx.supply),
    baseMint: ctx.baseMint,
    baseReserve: toBN(ctx.state.baseReserve),
    quoteReserve: toBN(ctx.state.effectiveQuoteReserve),
    quoteMint: ctx.pool.quoteMint,
    isMayhemMode: ctx.pool.isMayhemMode,
    creatorFeeBps: ctx.pool.creatorFeeBps,
  });
  return { lp: BigInt(f.lpFeeBps.toString()), protocol: BigInt(f.protocolFeeBps.toString()), creator: BigInt(f.creatorFeeBps.toString()) };
}

function split(amount: bigint, f: { lp: bigint; protocol: bigint; creator: bigint }) {
  return {
    lp: mulDivFloor(amount, f.lp, BPS_DENOMINATOR),
    protocol: mulDivFloor(amount, f.protocol, BPS_DENOMINATOR),
    creator: mulDivFloor(amount, f.creator, BPS_DENOMINATOR),
  };
}

export function quotePoolBuy(ctx: PoolContext, lamportsIn: bigint, slippageBps: number): TradeQuote {
  const r = buyQuoteInput({ ...poolArgs(ctx), quote: toBN(lamportsIn), slippage: pct(slippageBps) });
  const tokensOut = fromBN(r.base);
  const maxQuote = fromBN(r.maxQuote);
  const fees = ammFees(ctx);
  const parts = split(lamportsIn, fees);
  const spot = poolSpotPrice(ctx.state, ctx.decimals);
  const exec = tokensOut === 0n ? new D(0) : unitPrice(lamportsIn, SOL_DECIMALS, tokensOut, ctx.decimals);
  return {
    side: "BUY",
    venue: "PUMPSWAP",
    route: "PumpSwap AMM (buy: exact tokens out, max SOL in)",
    mint: ctx.baseMint.toBase58(),
    decimals: ctx.decimals,
    inputAmount: lamportsIn,
    expectedOutput: tokensOut,
    minOutput: tokensOut,
    maxInput: maxQuote,
    protocolFeeLamports: parts.protocol,
    creatorFeeLamports: parts.creator,
    lpFeeLamports: parts.lp,
    totalFeeBps: Number(fees.lp + fees.protocol + fees.creator),
    priceImpactBps: impactBps(spot, exec, "BUY"),
    spotPriceSolPerToken: spot.toFixed(),
    executionPriceSolPerToken: exec.toFixed(),
    slippageBps,
    slot: ctx.slot,
    quotedAt: new Date().toISOString(),
  };
}

export function quotePoolSell(ctx: PoolContext, tokensIn: bigint, slippageBps: number): TradeQuote {
  const r = sellBaseInput({ ...poolArgs(ctx), base: toBN(tokensIn), slippage: pct(slippageBps) });
  const solOut = fromBN(r.uiQuote);
  const fees = ammFees(ctx);
  const parts = split(solOut, fees);
  const spot = poolSpotPrice(ctx.state, ctx.decimals);
  const exec = tokensIn === 0n ? new D(0) : unitPrice(solOut, SOL_DECIMALS, tokensIn, ctx.decimals);
  return {
    side: "SELL",
    venue: "PUMPSWAP",
    route: "PumpSwap AMM (sell: exact tokens in, min SOL out)",
    mint: ctx.baseMint.toBase58(),
    decimals: ctx.decimals,
    inputAmount: tokensIn,
    expectedOutput: solOut,
    minOutput: fromBN(r.minQuote),
    maxInput: tokensIn,
    protocolFeeLamports: parts.protocol,
    creatorFeeLamports: parts.creator,
    lpFeeLamports: parts.lp,
    totalFeeBps: Number(fees.lp + fees.protocol + fees.creator),
    priceImpactBps: impactBps(spot, exec, "SELL"),
    spotPriceSolPerToken: spot.toFixed(),
    executionPriceSolPerToken: exec.toFixed(),
    slippageBps,
    slot: ctx.slot,
    quotedAt: new Date().toISOString(),
  };
}

export async function buildPoolBuy(connection: Connection, poolKey: PublicKey, user: PublicKey, quote: TradeQuote): Promise<TransactionInstruction[]> {
  const online = new OnlinePumpAmmSdk(connection);
  const state = await online.swapSolanaState(poolKey, user);
  return PUMP_AMM_SDK.buyInstructions(state, toBN(quote.expectedOutput), toBN(quote.maxInput));
}

export async function buildPoolSell(connection: Connection, poolKey: PublicKey, user: PublicKey, quote: TradeQuote): Promise<TransactionInstruction[]> {
  const online = new OnlinePumpAmmSdk(connection);
  const state = await online.swapSolanaState(poolKey, user);
  return PUMP_AMM_SDK.sellInstructions(state, toBN(quote.inputAmount), toBN(quote.minOutput));
}

export { PublicKey };

/** Base mint of a PumpSwap pool, or null when the account is not a pool. */
export function decodePoolBaseMint(info: import("@solana/web3.js").AccountInfo<Buffer>): string | null {
  try {
    return PUMP_AMM_SDK.decodePool(info).baseMint.toBase58();
  } catch {
    return null;
  }
}
