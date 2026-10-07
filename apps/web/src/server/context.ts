import "server-only";
import { getDb } from "@app/database";
import { getKv, getServerConfig } from "@app/shared/server";
import { getRpc } from "@app/solana/server";
import { TokenRegistry } from "@app/market";
import { Web3ChainGateway, domainOf, type ChainGateway, type OtcContext } from "@app/otc/server";
import { e2eEnabled, lazyE2EChain } from "./e2e";

const g = globalThis as unknown as { __registry?: TokenRegistry; __chain?: ChainGateway };

export const config = () => getServerConfig();

export function registry(): TokenRegistry {
  g.__registry ??= new TokenRegistry(getDb(), getRpc().connection, getServerConfig(), getKv());
  return g.__registry;
}

export function otcContext(): OtcContext {
  const config = getServerConfig();
  g.__chain ??= e2eEnabled() ? lazyE2EChain(config) : new Web3ChainGateway(getRpc().freshConnection);
  return { db: getDb(), chain: g.__chain, config, kv: getKv(), market: registry(), now: () => new Date() };
}

/** Configuration that is safe to hand to browsers. */
export function publicConfig() {
  const c = getServerConfig();
  return {
    appName: c.APP_NAME,
    appSymbol: c.APP_SYMBOL,
    cluster: c.SOLANA_CLUSTER,
    genesisHash: c.genesisHash,
    otcDomain: domainOf(c),
    rpcUrl: c.PUBLIC_SOLANA_RPC_URL,
    transactionsEnabled: c.transactionsEnabled,
    launchesEnabled: c.launchesEnabled,
    isMainnet: c.isMainnet,
    platformFeeBps: c.OTC_PLATFORM_FEE_BPS,
    feeMode: c.OTC_FEE_MODE,
    referralShareBps: c.OTC_REFERRAL_SHARE_BPS,
    treasuryWallet: c.PLATFORM_TREASURY_WALLET ?? null,
    minTtlSeconds: c.OTC_MIN_TTL_SECONDS,
    maxTtlSeconds: c.OTC_MAX_TTL_SECONDS,
    platformTokenMint: c.PLATFORM_TOKEN_MINT ?? null,
    priorityFeeMicroLamports: c.PRIORITY_FEE_MICROLAMPORTS,
    launchLinkUrl: c.launchLinkUrl,
    /** Discovery listing rules (applied on mainnet only). */
    listing: c.isMainnet
      ? { recentHours: c.LISTING_RECENT_HOURS, minMcapUsd: c.LISTING_MIN_MCAP_USD, minVolumeUsd: c.LISTING_MIN_VOLUME_USD, minGlobalFeesSol: c.BIRDEYE_API_KEY && c.LISTING_MIN_GLOBAL_FEES_SOL > 0 ? c.LISTING_MIN_GLOBAL_FEES_SOL : null, qualityChecks: c.DEXSCREENER_API }
      : null,
  };
}
export type PublicConfig = ReturnType<typeof publicConfig>;
