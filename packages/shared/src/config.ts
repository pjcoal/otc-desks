import { z } from "zod";
import { CLUSTERS, GENESIS_HASHES, type Cluster } from "./cluster";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const base58Key = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 public key");

export const FEE_MODES = ["BUYER_PAYS", "SELLER_PAYS", "SPLIT"] as const;
export type FeeMode = (typeof FEE_MODES)[number];

const DEV_SESSION_SECRET = "dev-only-insecure-session-secret-change-me-0000";

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_NAME: z.string().default("Desk 404"),
    APP_SYMBOL: z.string().default("DESK"),
    APP_URL: z.url().default("http://localhost:3000"),
    /** Site link written into every launched token's metadata (createdOn, description, website fallback). Defaults to APP_URL. */
    LAUNCH_LINK_URL: optionalString.pipe(z.url().optional()),
    SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(60 * 60 * 24 * 30).default(60 * 60 * 24 * 7),

    DATABASE_URL: z.string().default("postgresql://otc:otc@localhost:5432/otc"),
    REDIS_URL: optionalString,

    SOLANA_CLUSTER: z.enum(CLUSTERS).default("devnet"),
    SOLANA_RPC_URL: z.url().default("https://api.devnet.solana.com"),
    SOLANA_RPC_FALLBACK_URL: optionalString.pipe(z.url().optional()),
    SOLANA_WS_URL: optionalString.pipe(z.url().optional()),
    SOLANA_GENESIS_HASH: optionalString.pipe(base58Key.optional()),
    /** RPC endpoint handed to browsers (wallet adapter). Never put a keyed/private RPC URL here. */
    PUBLIC_SOLANA_RPC_URL: z.url().default("https://api.devnet.solana.com"),
    ALLOW_MAINNET: bool(false),
    /** Owner opt-in for token launches only (create_v2) on mainnet, without enabling trading or OTC settlement. */
    ALLOW_MAINNET_LAUNCHES: bool(false),
    /** Must be set to "yes" (after completing docs/mainnet-checklist.md) for ALLOW_MAINNET to take effect. */
    MAINNET_CHECKLIST_COMPLETED: optionalString,
    SIMULATE_TRANSACTIONS: bool(true),
    PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().min(0).max(5_000_000).default(0),

    PLATFORM_TREASURY_WALLET: optionalString.pipe(base58Key.optional()),
    OTC_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
    OTC_FEE_MODE: z.enum(FEE_MODES).default("SELLER_PAYS"),
    OTC_REFERRAL_SHARE_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
    OTC_MIN_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
    OTC_MAX_TTL_SECONDS: z.coerce.number().int().max(60 * 60 * 24 * 90).default(60 * 60 * 24 * 30),
    OTC_MAX_OPEN_ORDERS_PER_WALLET: z.coerce.number().int().min(1).default(50),
    /** Allow tokens that still have a freeze authority. Pump mints have none; off by default. */
    OTC_ALLOW_FREEZE_AUTHORITY: bool(false),

    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY: optionalString,
    S3_SECRET_KEY: optionalString,
    S3_PUBLIC_BASE_URL: optionalString,
    METADATA_PROVIDER: z.enum(["local", "s3", "pinata"]).default("local"),
    METADATA_API_KEY: optionalString,
    /** Gateway written into URLs of files this site pins with Pinata (launch images and metadata, recorded on-chain). */
    PINATA_GATEWAY_URL: z.url().default("https://gateway.pinata.cloud/ipfs/"),
    /** Primary IPFS gateway. ipfs.io and its sister gateways no longer serve plain HTTP reliably (429s). */
    IPFS_GATEWAY_URL: z.url().default("https://4everland.io/ipfs/"),
    /** Tried in order when the primary gateway fails; IPFS content is content-addressed, so any gateway is equivalent. */
    IPFS_FALLBACK_GATEWAYS: z
      .string()
      .optional()
      .transform((v) => (v ?? "https://pump.mypinata.cloud/ipfs/,https://gateway.pinata.cloud/ipfs/").split(",").map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(z.url())),

    ADMIN_WALLETS: csv.pipe(z.array(base58Key)),
    PLATFORM_TOKEN_MINT: optionalString.pipe(base58Key.optional()),
    BLOCKED_REGIONS: csv,
    /** Number of trusted reverse proxies in front of the app (X-Forwarded-For is read from the right). */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    INDEXER_MODE: z.enum(["firehose", "tracked"]).default("firehose"),
    /** Optional, unofficial discovery source (mainnet only). Prices/settlement always come from chain. */
    PUMP_DISCOVERY_API: bool(false),
    PUMP_DISCOVERY_API_URL: z.url().default("https://frontend-api-v3.pump.fun"),
    /** Optional 24h-volume source for listings (mainnet only). Display/filtering only; never used to price trades. */
    DEXSCREENER_API: bool(false),
    DEXSCREENER_API_URL: z.url().default("https://api.dexscreener.com"),
    /**
     * Listing rules (mainnet): a coin younger than LISTING_RECENT_HOURS is listed once its market cap
     * reaches LISTING_MIN_MCAP_USD; an older coin needs LISTING_MIN_VOLUME_USD of 24h volume.
     * Coins launched through this site are always listed. Token pages stay reachable by mint.
     */
    LISTING_RECENT_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(72),
    LISTING_MIN_MCAP_USD: z.coerce.number().int().min(0).default(500_000),
    LISTING_MIN_VOLUME_USD: z.coerce.number().int().min(0).default(100_000),
    /**
     * Chart-quality rules (need DEXSCREENER_API): filter out rugs and faked charts. A listed coin's
     * pools must hold LISTING_MIN_LIQUIDITY_SOL, liquidity must be at least LISTING_MIN_LIQ_MCAP_PCT of
     * market cap (inflated caps on thin pools), 24h sells at least LISTING_MIN_SELL_BUY_RATIO of buys
     * (one-sided bot buying), and the price must not have fallen more than LISTING_MAX_DROP_24H_PCT in 24h.
     */
    LISTING_MIN_LIQUIDITY_SOL: z.coerce.number().min(0).max(1_000_000).default(50),
    LISTING_MIN_LIQ_MCAP_PCT: z.coerce.number().min(0).max(100).default(1.5),
    LISTING_MIN_SELL_BUY_RATIO: z.coerce.number().min(0).max(10).default(0.25),
    LISTING_MAX_DROP_24H_PCT: z.coerce.number().min(0).max(100).default(75),
    /** All-time global fees paid (SOL) a listed coin needs. Applied only when BIRDEYE_API_KEY is set; 0 disables. */
    LISTING_MIN_GLOBAL_FEES_SOL: z.coerce.number().min(0).max(1_000_000).default(50),
    /** Birdeye Data API key (Business plan or higher: global-fees endpoints). Server-only; never sent to browsers. */
    BIRDEYE_API_KEY: optionalString,
    BIRDEYE_API_URL: z.url().default("https://public-api.birdeye.so"),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    ERROR_WEBHOOK_URL: optionalString.pipe(z.url().optional()),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (env.NODE_ENV === "production" && env.SESSION_SECRET === DEV_SESSION_SECRET) {
      issue("SESSION_SECRET", "a unique SESSION_SECRET is required in production");
    }
    if (env.SOLANA_CLUSTER === "localnet" && !env.SOLANA_GENESIS_HASH) {
      issue("SOLANA_GENESIS_HASH", "required for localnet (solana genesis-hash)");
    }
    if (env.SOLANA_CLUSTER === "mainnet-beta" && env.ALLOW_MAINNET) {
      if (env.MAINNET_CHECKLIST_COMPLETED !== "yes") issue("MAINNET_CHECKLIST_COMPLETED", 'set to "yes" only after completing docs/mainnet-checklist.md');
      if (!env.SIMULATE_TRANSACTIONS) issue("SIMULATE_TRANSACTIONS", "must be true on mainnet");
      if (!env.SOLANA_RPC_FALLBACK_URL) issue("SOLANA_RPC_FALLBACK_URL", "a fallback RPC is required on mainnet");
      if (!env.REDIS_URL) issue("REDIS_URL", "Redis is required on mainnet (rate limits, locks)");
      if (env.SESSION_SECRET === DEV_SESSION_SECRET) issue("SESSION_SECRET", "must be set on mainnet");
      if (!env.APP_URL.startsWith("https://")) issue("APP_URL", "must be https on mainnet");
    }
    if (env.SOLANA_CLUSTER === "mainnet-beta" && env.ALLOW_MAINNET_LAUNCHES) {
      if (!env.SIMULATE_TRANSACTIONS) issue("SIMULATE_TRANSACTIONS", "must be true on mainnet");
      if (!env.REDIS_URL) issue("REDIS_URL", "Redis is required for mainnet launches (rate limits, issued metadata)");
      if (env.SESSION_SECRET === DEV_SESSION_SECRET) issue("SESSION_SECRET", "must be set on mainnet");
      if (!env.APP_URL.startsWith("https://")) issue("APP_URL", "must be https on mainnet");
      if (env.METADATA_PROVIDER === "local") issue("METADATA_PROVIDER", "launches on mainnet need pinata or s3 storage");
    }
    if (env.OTC_PLATFORM_FEE_BPS > 0 && !env.PLATFORM_TREASURY_WALLET) {
      issue("PLATFORM_TREASURY_WALLET", "required when OTC_PLATFORM_FEE_BPS > 0");
    }
    if (env.OTC_MIN_TTL_SECONDS >= env.OTC_MAX_TTL_SECONDS) {
      issue("OTC_MIN_TTL_SECONDS", "must be smaller than OTC_MAX_TTL_SECONDS");
    }
  });

export type ServerConfig = z.infer<typeof serverEnvSchema> & {
  genesisHash: string;
  isMainnet: boolean;
  /** True when this deployment may build/submit transactions for the configured cluster. */
  transactionsEnabled: boolean;
  /** True when token launches may be built/submitted (all transactions, or the launch-only opt-in). */
  launchesEnabled: boolean;
  /** LAUNCH_LINK_URL or APP_URL, without a trailing slash. */
  launchLinkUrl: string;
};

let cached: ServerConfig | undefined;

export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server configuration:\n${lines}`);
  }
  const c = parsed.data;
  const cluster: Cluster = c.SOLANA_CLUSTER;
  const genesisHash = c.SOLANA_GENESIS_HASH ?? (cluster === "localnet" ? "" : GENESIS_HASHES[cluster]);
  const isMainnet = cluster === "mainnet-beta";
  return { ...c, genesisHash, isMainnet, transactionsEnabled: !isMainnet || c.ALLOW_MAINNET, launchesEnabled: !isMainnet || c.ALLOW_MAINNET || c.ALLOW_MAINNET_LAUNCHES, launchLinkUrl: (c.LAUNCH_LINK_URL ?? c.APP_URL).replace(/\/+$/, "") };
}

export function getServerConfig(): ServerConfig {
  cached ??= loadServerConfig();
  return cached;
}

/** Test hook. */
export function resetServerConfig(next?: ServerConfig): void {
  cached = next;
}
