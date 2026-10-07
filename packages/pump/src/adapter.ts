/**
 * The Pump adapter is the ONLY module that talks to Pump/PumpSwap programs or SDKs. Callers deal in
 * our own types (bigint amounts, MarketSnapshot, TradeQuote). A future protocol upgrade should only
 * require changes inside packages/pump.
 */
import {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  canonicalPumpPoolPda,
  newBondingCurve,
  type BondingCurve,
  type FeeConfig,
  type Global,
} from "@pump-fun/pump-sdk";
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, type FeeConfig as AmmFeeConfig, type GlobalConfig } from "@pump-fun/pump-swap-sdk";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { PublicKey, TransactionInstruction, type AccountInfo, type Connection } from "@solana/web3.js";
import { AppError } from "@app/shared";
import { inspectTokenAccountInfo } from "@app/solana";
import { COMPUTE_UNITS, PUMP_EXPECTED_DECIMALS, PUMP_PROGRAM_ID } from "./constants";
import {
  bondingProgressBps,
  curveMarketCapLamports,
  curveSpotPrice,
  fromBN,
  isSolQuoted,
  quoteCurveBuy,
  quoteCurveSell,
  toBN,
  toCurveState,
  type CurveContext,
} from "./bonding-curve";
import { decodePumpIxData, encodeBuyExactQuoteInV2, encodeSellV2 } from "./ix-data";
import { buildPoolBuy, buildPoolSell, decodeRawMint, poolMarketCapLamports, poolSpotPrice, quotePoolBuy, quotePoolSell, toPoolState, type PoolContext } from "./pumpswap";
import type { MarketSnapshot, TradeQuote } from "./types";

const CONFIG_TTL_MS = 30_000;

interface Cached<T> {
  at: number;
  value: T;
}

export interface BuiltTrade {
  instructions: TransactionInstruction[];
  computeUnits: number;
  quote: TradeQuote;
}

export interface CreateTokenParams {
  mint: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  /** Lamports to spend on an atomic first buy; 0 = create only. */
  initialBuyLamports: bigint;
  slippageBps: number;
  holderReward?: boolean;
}

export interface BuiltCreate {
  instructions: TransactionInstruction[];
  computeUnits: number;
  initialBuy: TradeQuote | null;
  bondingCurve: string;
}

/**
 * Rewrite an SDK-built `buy_v2` (exact tokens out) into `buy_exact_quote_in_v2` (exact SOL in,
 * minimum tokens out). The IDL declares identical account lists for both; `ix-data.test.ts` asserts
 * that invariant against the installed IDL so an upgrade that breaks it fails CI.
 */
export function toExactQuoteIn(ix: TransactionInstruction, spendableLamports: bigint, minTokensOut: bigint): TransactionInstruction {
  if (!ix.programId.equals(PUMP_PROGRAM_ID) || decodePumpIxData(ix.data).kind !== "buy_v2") {
    throw new Error("toExactQuoteIn expects a Pump buy_v2 instruction");
  }
  return new TransactionInstruction({ programId: ix.programId, keys: ix.keys, data: Buffer.from(encodeBuyExactQuoteInV2(spendableLamports, minTokensOut)) });
}

export class PumpAdapter {
  private readonly online: OnlinePumpSdk;
  private readonly onlineAmm: OnlinePumpAmmSdk;
  private global?: Cached<Global>;
  private feeConfig?: Cached<FeeConfig | null>;
  private ammGlobal?: Cached<GlobalConfig>;
  private ammFeeConfig?: Cached<AmmFeeConfig | null>;

  constructor(private readonly connection: Connection) {
    this.online = new OnlinePumpSdk(connection);
    this.onlineAmm = new OnlinePumpAmmSdk(connection);
  }

  private async cached<T>(slot: Cached<T> | undefined, load: () => Promise<T>, set: (c: Cached<T>) => void): Promise<T> {
    if (slot && Date.now() - slot.at < CONFIG_TTL_MS) return slot.value;
    const value = await load();
    set({ at: Date.now(), value });
    return value;
  }

  fetchGlobal(): Promise<Global> {
    return this.cached(this.global, () => this.online.fetchGlobal(), (c) => (this.global = c));
  }
  fetchFeeConfig(): Promise<FeeConfig | null> {
    return this.cached(this.feeConfig, () => this.online.fetchFeeConfig().catch(() => null), (c) => (this.feeConfig = c));
  }
  private fetchAmmGlobal(): Promise<GlobalConfig> {
    return this.cached(this.ammGlobal, () => this.onlineAmm.fetchGlobalConfigAccount(), (c) => (this.ammGlobal = c));
  }
  private fetchAmmFeeConfig(): Promise<AmmFeeConfig | null> {
    return this.cached(this.ammFeeConfig, () => this.onlineAmm.fetchFeeConfigAccount().catch(() => null), (c) => (this.ammFeeConfig = c));
  }

  /** One RPC round-trip for mint + curve + canonical pool, then venue detection. */
  async getMarket(mintAddress: string): Promise<MarketSnapshot & { _curve?: BondingCurve; _poolCtx?: PoolContext }> {
    const mint = new PublicKey(mintAddress);
    const curveKey = bondingCurvePda(mint);
    const poolKey = canonicalPumpPoolPda(mint);
    const { context, value } = await this.connection.getMultipleAccountsInfoAndContext([mint, curveKey, poolKey]);
    const [mintInfo, curveInfo, poolInfo] = value;
    if (!mintInfo) throw new AppError("NOT_FOUND", "Mint account not found on this network.");
    const decoded = unpackMint(mint, mintInfo, mintInfo.owner);
    const base = {
      mint: mintAddress,
      tokenProgram: mintInfo.owner.toBase58(),
      decimals: decoded.decimals,
      supply: decoded.supply,
      slot: context.slot,
      fetchedAt: new Date().toISOString(),
    };

    let curve: BondingCurve | null = null;
    if (curveInfo && curveInfo.owner.equals(PUMP_PROGRAM_ID)) curve = PUMP_SDK.decodeBondingCurve(curveInfo);

    if (curve && !curve.complete) {
      const global = await this.fetchGlobal();
      const state = toCurveState(curveKey, curve);
      const solQuoted = isSolQuoted(curve.quoteMint);
      return {
        ...base,
        venue: "PUMP_BONDING_CURVE",
        tradable: solQuoted,
        ...(solQuoted ? {} : { note: `Curve is quoted in ${state.quoteMint}; only SOL-quoted markets are supported.` }),
        priceSolPerToken: curveSpotPrice(state, decoded.decimals).toFixed(),
        marketCapLamports: curveMarketCapLamports(curve),
        liquidityLamports: state.realSolReserves,
        progressBps: bondingProgressBps(state.realTokenReserves, fromBN(global.initialRealTokenReserves), false),
        bondingCurve: state,
        pool: null,
        _curve: curve,
      };
    }

    if (poolInfo) {
      const ctx = await this.poolContext(poolKey, poolInfo, mint, mintInfo, decoded.decimals, decoded.supply, context.slot);
      const solQuoted = ctx.state.quoteMint === "SOL";
      return {
        ...base,
        venue: "PUMPSWAP",
        tradable: solQuoted,
        ...(solQuoted ? {} : { note: "Pool is not SOL-quoted; only SOL-quoted markets are supported." }),
        priceSolPerToken: poolSpotPrice(ctx.state, decoded.decimals).toFixed(),
        marketCapLamports: poolMarketCapLamports(ctx.state, decoded.supply),
        liquidityLamports: ctx.state.quoteReserve * 2n,
        progressBps: curve ? 10_000 : null,
        bondingCurve: curve ? toCurveState(curveKey, curve) : null,
        pool: ctx.state,
        _poolCtx: ctx,
      };
    }

    return {
      ...base,
      venue: "UNKNOWN",
      tradable: false,
      note: curve ? "Bonding curve complete; awaiting migration to PumpSwap." : "No Pump bonding curve or canonical PumpSwap pool exists for this mint.",
      priceSolPerToken: "0",
      marketCapLamports: 0n,
      liquidityLamports: 0n,
      progressBps: curve ? 10_000 : null,
      bondingCurve: curve ? toCurveState(curveKey, curve) : null,
      pool: null,
    };
  }

  private async poolContext(
    poolKey: PublicKey,
    poolInfo: AccountInfo<Buffer>,
    mint: PublicKey,
    mintInfo: AccountInfo<Buffer>,
    decimals: number,
    supply: bigint,
    slot: number,
  ): Promise<PoolContext> {
    const pool = PUMP_AMM_SDK.decodePool(poolInfo);
    const [vaults, globalConfig, feeConfig] = await Promise.all([
      this.connection.getMultipleAccountsInfo([pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount]),
      this.fetchAmmGlobal(),
      this.fetchAmmFeeConfig(),
    ]);
    const baseReserve = inspectTokenAccountInfo(pool.poolBaseTokenAccount, vaults[0] ?? null).amount;
    const quoteReserve = inspectTokenAccountInfo(pool.poolQuoteTokenAccount, vaults[1] ?? null).amount;
    return {
      poolKey,
      pool,
      state: toPoolState(poolKey, pool, baseReserve, quoteReserve),
      globalConfig,
      feeConfig,
      baseMint: mint,
      baseMintAccount: decodeRawMint(mintInfo.data),
      decimals,
      supply,
      slot,
    };
  }

  private async curveContext(market: Awaited<ReturnType<PumpAdapter["getMarket"]>>): Promise<CurveContext> {
    if (!market._curve) throw new AppError("VENUE_UNAVAILABLE");
    const [global, feeConfig] = await Promise.all([this.fetchGlobal(), this.fetchFeeConfig()]);
    return { global, feeConfig, curve: market._curve, mintSupply: market.supply, decimals: market.decimals, slot: market.slot };
  }

  private requireTradable(market: MarketSnapshot): void {
    if (market.venue === "UNKNOWN") throw new AppError(market.bondingCurve?.complete ? "CURVE_COMPLETE" : "VENUE_UNAVAILABLE", market.note);
    if (!market.tradable) throw new AppError("UNSUPPORTED_QUOTE_MINT", market.note);
  }

  async quoteBuy(mint: string, lamportsIn: bigint, slippageBps: number): Promise<TradeQuote> {
    const market = await this.getMarket(mint);
    this.requireTradable(market);
    const q = market.venue === "PUMP_BONDING_CURVE" ? quoteCurveBuy(await this.curveContext(market), lamportsIn, slippageBps) : quotePoolBuy(market._poolCtx!, lamportsIn, slippageBps);
    return { ...q, mint };
  }

  async quoteSell(mint: string, tokensIn: bigint, slippageBps: number): Promise<TradeQuote> {
    const market = await this.getMarket(mint);
    this.requireTradable(market);
    const q = market.venue === "PUMP_BONDING_CURVE" ? quoteCurveSell(await this.curveContext(market), tokensIn, slippageBps) : quotePoolSell(market._poolCtx!, tokensIn, slippageBps);
    return { ...q, mint };
  }

  async buildBuy(mint: string, user: PublicKey, lamportsIn: bigint, slippageBps: number): Promise<BuiltTrade> {
    const market = await this.getMarket(mint);
    this.requireTradable(market);
    const mintPk = new PublicKey(mint);
    if (market.venue === "PUMP_BONDING_CURVE") {
      const ctx = await this.curveContext(market);
      const quote = { ...quoteCurveBuy(ctx, lamportsIn, slippageBps), mint };
      if (quote.expectedOutput === 0n) throw new AppError("VALIDATION", "Amount too small to buy any tokens.");
      const { bondingCurveAccountInfo, associatedUserAccountInfo, quoteTokenProgram } = await this.online.fetchBuyState(mintPk, user, new PublicKey(market.tokenProgram));
      const ixs = await PUMP_SDK.buyV2Instructions({
        global: ctx.global,
        bondingCurveAccountInfo,
        bondingCurve: ctx.curve,
        associatedUserAccountInfo,
        mint: mintPk,
        user,
        amount: toBN(quote.expectedOutput),
        quoteAmount: toBN(lamportsIn),
        slippage: 0,
        tokenProgram: new PublicKey(market.tokenProgram),
        quoteTokenProgram,
      });
      const instructions = ixs.map((ix) => (ix.programId.equals(PUMP_PROGRAM_ID) ? toExactQuoteIn(ix, lamportsIn, quote.minOutput) : ix));
      return { instructions, computeUnits: COMPUTE_UNITS.bondingCurveTrade, quote };
    }
    const ctx = market._poolCtx!;
    const quote = { ...quotePoolBuy(ctx, lamportsIn, slippageBps), mint };
    return { instructions: await buildPoolBuy(this.connection, ctx.poolKey, user, quote), computeUnits: COMPUTE_UNITS.ammTrade, quote };
  }

  async buildSell(mint: string, user: PublicKey, tokensIn: bigint, slippageBps: number): Promise<BuiltTrade> {
    const market = await this.getMarket(mint);
    this.requireTradable(market);
    const mintPk = new PublicKey(mint);
    if (market.venue === "PUMP_BONDING_CURVE") {
      const ctx = await this.curveContext(market);
      const quote = { ...quoteCurveSell(ctx, tokensIn, slippageBps), mint };
      const { bondingCurveAccountInfo, quoteTokenProgram } = await this.online.fetchSellState(mintPk, user, new PublicKey(market.tokenProgram));
      const ixs = await PUMP_SDK.sellV2Instructions({
        global: ctx.global,
        bondingCurveAccountInfo,
        bondingCurve: ctx.curve,
        mint: mintPk,
        user,
        amount: toBN(tokensIn),
        quoteAmount: toBN(quote.minOutput),
        slippage: 0,
        tokenProgram: new PublicKey(market.tokenProgram),
        quoteTokenProgram,
      });
      // Fail closed if the SDK did not encode exactly our bigint limits (slippage is ours, in integer bps).
      const expected = Buffer.from(encodeSellV2(tokensIn, quote.minOutput));
      for (const ix of ixs) {
        if (ix.programId.equals(PUMP_PROGRAM_ID) && !ix.data.equals(expected)) {
          throw new Error("Pump SDK produced unexpected sell_v2 arguments; refusing to build");
        }
      }
      return { instructions: ixs, computeUnits: COMPUTE_UNITS.bondingCurveTrade, quote };
    }
    const ctx = market._poolCtx!;
    const quote = { ...quotePoolSell(ctx, tokensIn, slippageBps), mint };
    return { instructions: await buildPoolSell(this.connection, ctx.poolKey, user, quote), computeUnits: COMPUTE_UNITS.ammTrade, quote };
  }

  /**
   * create_v2 (Token-2022) — optionally with an atomic first buy. The mint keypair is generated and
   * held client-side; only its public key reaches this function.
   */
  async buildCreate(p: CreateTokenParams): Promise<BuiltCreate> {
    const global = await this.fetchGlobal();
    if (!global.createV2Enabled) throw new AppError("VENUE_UNAVAILABLE", "Pump has create_v2 disabled on this network.");
    const common = {
      mint: p.mint,
      name: p.name,
      symbol: p.symbol,
      uri: p.uri,
      creator: p.creator,
      user: p.creator,
      mayhemMode: false,
      ...(p.holderReward ? { holderReward: true } : {}),
    };
    const bondingCurve = bondingCurvePda(p.mint).toBase58();
    if (p.initialBuyLamports === 0n) {
      return { instructions: [await PUMP_SDK.createV2Instruction(common)], computeUnits: COMPUTE_UNITS.createV2, initialBuy: null, bondingCurve };
    }
    const feeConfig = await this.fetchFeeConfig();
    // Quote against the curve create_v2 will initialise (null curve ⇒ SDK seeds from Global).
    const fresh = newBondingCurve(global, PublicKey.default, undefined, undefined, p.holderReward ?? false);
    fresh.creator = p.creator; // creator fee applies on the first buy
    const quote = {
      ...quoteCurveBuy({ global, feeConfig, curve: fresh, mintSupply: fromBN(global.tokenTotalSupply), decimals: PUMP_EXPECTED_DECIMALS, slot: 0 }, p.initialBuyLamports, p.slippageBps),
      mint: p.mint.toBase58(),
    };
    const ixs = await PUMP_SDK.createV2AndBuyV2Instructions({
      ...common,
      global,
      amount: toBN(quote.expectedOutput),
      quoteAmount: toBN(p.initialBuyLamports),
      quoteMint: NATIVE_MINT,
    });
    const instructions = ixs.map((ix) =>
      ix.programId.equals(PUMP_PROGRAM_ID) && decodePumpIxData(ix.data).kind === "buy_v2" ? toExactQuoteIn(ix, p.initialBuyLamports, quote.minOutput) : ix,
    );
    return { instructions, computeUnits: COMPUTE_UNITS.createV2AndBuy, initialBuy: quote, bondingCurve };
  }
}

export const TOKEN_2022 = TOKEN_2022_PROGRAM_ID;
