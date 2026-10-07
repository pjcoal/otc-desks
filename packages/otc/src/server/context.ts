import type { Db } from "@app/database";
import type { KeyValueStore, ServerConfig } from "@app/shared/server";
import type { ChainGateway } from "./chain";
import type { OtcDomain } from "../schema";

export interface ReferencePrice {
  priceSolPerToken: string;
  at: Date;
  venue: string;
}

export interface TokenInfo {
  mint: string;
  tokenProgram: string;
  decimals: number;
  symbol: string;
  name: string;
  imageUrl: string | null;
  /** True when the mint has a Pump bonding curve or canonical PumpSwap pool. */
  isPumpToken: boolean;
}

/** Market data the OTC layer needs, provided by the Pump-backed token registry. */
export interface MarketReader {
  ensureToken(mint: string): Promise<TokenInfo | null>;
  referencePrice(mint: string): Promise<ReferencePrice | null>;
}

export interface OtcContext {
  db: Db;
  chain: ChainGateway;
  config: ServerConfig;
  kv: KeyValueStore;
  market: MarketReader;
  now(): Date;
}

export function domainOf(config: ServerConfig): OtcDomain {
  return { environment: new URL(config.APP_URL).host, network: config.SOLANA_CLUSTER, genesisHash: config.genesisHash };
}

export const nowSeconds = (ctx: OtcContext) => Math.floor(ctx.now().getTime() / 1000);

/** Acceptance hold: how long an accepted order stays reserved for settlement. */
export const ACCEPT_HOLD_SECONDS = 10 * 60;
/** An order must have at least this long left to start a settlement (blockhash lifetime + margin). */
export const SETTLEMENT_MIN_REMAINING_SECONDS = 180;
/** Treat a blockhash as unusable for new signatures this many blocks before it expires. */
export const BLOCKHASH_SAFETY_MARGIN = 10;
