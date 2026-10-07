export type MarketVenue = "PUMP_BONDING_CURVE" | "PUMPSWAP" | "UNKNOWN";

export interface BondingCurveState {
  address: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
  isMayhemMode: boolean;
  isHolderReward: boolean;
  isCashbackCoin: boolean;
  /** "SOL" for SOL-quoted curves, otherwise the quote mint. */
  quoteMint: string;
  creatorFeeBps: number;
}

export interface PoolState {
  address: string;
  baseReserve: bigint;
  quoteReserve: bigint;
  /** Signed (i128 on chain since 2026-09-30); may be negative. */
  virtualQuoteReserves: bigint;
  effectiveQuoteReserve: bigint;
  lpSupply: bigint;
  creator: string;
  coinCreator: string;
  quoteMint: string;
  isMayhemMode: boolean;
}

export interface MarketSnapshot {
  mint: string;
  venue: MarketVenue;
  /** Human explanation when venue is UNKNOWN or the market is not tradable here. */
  note?: string;
  tradable: boolean;
  tokenProgram: string;
  decimals: number;
  supply: bigint;
  /** SOL per whole token, decimal string. */
  priceSolPerToken: string;
  marketCapLamports: bigint;
  liquidityLamports: bigint;
  progressBps: number | null;
  bondingCurve: BondingCurveState | null;
  pool: PoolState | null;
  slot: number;
  fetchedAt: string;
}

export type TradeSide = "BUY" | "SELL";

export interface TradeQuote {
  side: TradeSide;
  venue: Exclude<MarketVenue, "UNKNOWN">;
  route: string;
  mint: string;
  decimals: number;
  /** BUY: lamports the user specified. SELL: raw tokens the user sells. */
  inputAmount: bigint;
  /** BUY: raw tokens. SELL: lamports. */
  expectedOutput: bigint;
  /** Worst case accepted by the instruction (slippage applied). */
  minOutput: bigint;
  /** Worst-case input the instruction may consume (== inputAmount for exact-in routes). */
  maxInput: bigint;
  protocolFeeLamports: bigint;
  creatorFeeLamports: bigint;
  lpFeeLamports: bigint;
  totalFeeBps: number;
  /** Positive = worse than spot. */
  priceImpactBps: number;
  spotPriceSolPerToken: string;
  executionPriceSolPerToken: string;
  slippageBps: number;
  slot: number;
  quotedAt: string;
}
