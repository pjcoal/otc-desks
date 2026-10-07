/** Client-side shapes of API responses (amounts are integer strings). */
export interface TokenCard {
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  decimals: number;
  venue: string;
  complete: boolean;
  createdAt: string;
  graduatedAt: string | null;
  creator: string | null;
  market: { priceSolPerToken: string; marketCapLamports: string; volume24hLamports: string; trades24h: number; bondingProgressBps: number | null } | null;
}

export interface Snapshot {
  mint: string;
  venue: "PUMP_BONDING_CURVE" | "PUMPSWAP" | "UNKNOWN";
  note?: string;
  tradable: boolean;
  tokenProgram: string;
  decimals: number;
  supply: string;
  priceSolPerToken: string;
  marketCapLamports: string;
  liquidityLamports: string;
  progressBps: number | null;
  bondingCurve: Record<string, string | number | boolean> | null;
  pool: Record<string, string | number | boolean> | null;
  slot: number;
  fetchedAt: string;
}

export interface TokenDetail {
  token: { mint: string; name: string; symbol: string; imageUrl: string | null; decimals: number; tokenProgram: string; creator: string | null; createdAt: string; launchedViaPlatform: boolean };
  metadata: { description: string | null; website: string | null; twitter: string | null; telegram: string | null; uri: string | null; verifiedOnChain: boolean } | null;
  market: Snapshot;
  safety: { ok: boolean; blockers: string[]; warnings: string[]; extensions: string[]; freezeAuthority: string | null; mintAuthority: string | null; transferFeeBps: number | null };
  stats: { volume24hLamports: string; trades24h: number; holderCount: number | null };
}

export interface Quote {
  side: "BUY" | "SELL";
  venue: string;
  route: string;
  mint: string;
  decimals: number;
  inputAmount: string;
  expectedOutput: string;
  minOutput: string;
  maxInput: string;
  protocolFeeLamports: string;
  creatorFeeLamports: string;
  lpFeeLamports: string;
  totalFeeBps: number;
  priceImpactBps: number;
  spotPriceSolPerToken: string;
  executionPriceSolPerToken: string;
  slippageBps: number;
  slot: number;
  quotedAt: string;
}

export interface FeeLine {
  destination: string;
  label: string;
  lamports: string;
  bps: number | null;
}

export interface OtcTradeRow {
  txSignature: string | null;
  tokenMint: string;
  symbol: string;
  decimals: number;
  tokenAmountRaw: string;
  grossQuoteLamports: string;
  platformFeeLamports: string;
  seller: string;
  buyer: string;
  refPriceSolPerToken: string | null;
  blockTime: string | null;
}
