import { Keypair } from "@solana/web3.js";

/** Deterministic test identities (never use these seeds anywhere real). */
export const SELLER_SEED = "11".repeat(32);
export const BUYER_SEED = "22".repeat(32);
const pub = (hex: string) => Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, "hex"))).publicKey.toBase58();
export const SELLER = pub(SELLER_SEED);
export const BUYER = pub(BUYER_SEED);
const TREASURY = pub("33".repeat(32));

export const E2E_ENV = {
  PORT: "3100",
  NODE_ENV: "production",
  APP_URL: "http://localhost:3100",
  SESSION_SECRET: "e2e-only-session-secret-not-for-real-use-000000",
  SOLANA_CLUSTER: "localnet",
  SOLANA_GENESIS_HASH: pub("55".repeat(32)), // any valid base58 hash: localnet genesis is per-validator
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  PUBLIC_SOLANA_RPC_URL: "https://api.devnet.solana.com",
  PLATFORM_TREASURY_WALLET: TREASURY,
  OTC_PLATFORM_FEE_BPS: "50",
  OTC_FEE_MODE: "SELLER_PAYS",
  E2E_LITESVM: "1",
  E2E_SELLER: SELLER,
  E2E_BUYER: BUYER,
  LOG_LEVEL: "warn",
} as const;
