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
    IPFS_GATEWAY_URL: z.url().default("https://ipfs.io/ipfs/"),

    ADMIN_WALLETS: csv.pipe(z.array(base58Key)),
    PLATFORM_TOKEN_MINT: optionalString.pipe(base58Key.optional()),
    BLOCKED_REGIONS: csv,
    /** Number of trusted reverse proxies in front of the app (X-Forwarded-For is read from the right). */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    INDEXER_MODE: z.enum(["firehose", "tracked"]).default("firehose"),
    /** Optional, unofficial discovery source (mainnet only). Prices/settlement always come from chain. */
    PUMP_DISCOVERY_API: bool(false),
    PUMP_DISCOVERY_API_URL: z.url().default("https://frontend-api-v3.pump.fun"),
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
  return { ...c, genesisHash, isMainnet, transactionsEnabled: !isMainnet || c.ALLOW_MAINNET };
}

export function getServerConfig(): ServerConfig {
  cached ??= loadServerConfig();
  return cached;
}

/** Test hook. */
export function resetServerConfig(next?: ServerConfig): void {
  cached = next;
}
