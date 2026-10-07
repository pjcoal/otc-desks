/**
 * Every Pump protocol constant lives here. Values were verified on 2026-10-07 against
 * @pump-fun/pump-sdk@2.0.0, @pump-fun/pump-swap-sdk@1.20.0 and github.com/pump-fun/pump-public-docs.
 * `constants.test.ts` asserts these still equal what the installed SDKs export, so an SDK upgrade
 * that moves an address fails CI instead of silently changing behaviour.
 */
import { PublicKey } from "@solana/web3.js";

export const PUMP_SDK_VERSION = "2.0.0";
export const PUMP_SWAP_SDK_VERSION = "1.20.0";
export const PROTOCOL_VERIFIED_AT = "2026-10-07";

/** Same addresses on mainnet-beta and devnet. */
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

/** Anchor instruction discriminators (from the vendored IDL; asserted in tests). */
export const DISCRIMINATORS = {
  createV2: Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]),
  buyV2: Uint8Array.from([184, 23, 238, 97, 103, 197, 211, 61]),
  buyExactQuoteInV2: Uint8Array.from([194, 171, 28, 70, 104, 77, 91, 47]),
  sellV2: Uint8Array.from([93, 246, 130, 60, 231, 233, 64, 178]),
} as const;

/** PumpSwap (pump-amm) trade discriminators (asserted in tests against the SDK's IDL). */
export const AMM_DISCRIMINATORS = {
  buy: Uint8Array.from([102, 6, 61, 18, 1, 218, 235, 234]),
  sell: Uint8Array.from([51, 230, 133, 164, 1, 127, 131, 173]),
  buyExactQuoteIn: Uint8Array.from([198, 46, 21, 82, 180, 217, 232, 112]),
} as const;

/** Anchor `emit_cpi!` self-invocation tag preceding the event discriminator. */
export const ANCHOR_EVENT_IX_TAG = Uint8Array.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

/** Pump coins: 6 decimals, 1B supply. Always re-read from chain; these are for sanity checks. */
export const PUMP_EXPECTED_DECIMALS = 6;
export const PUMP_EXPECTED_SUPPLY_RAW = 1_000_000_000_000_000n;

/** Compute budgets (FAQ recommends a static, generous limit to avoid simulation round-trips). */
export const COMPUTE_UNITS = {
  bondingCurveTrade: 150_000,
  ammTrade: 250_000,
  createV2: 300_000,
  createV2AndBuy: 450_000,
} as const;

/** Representation of SOL as a quote asset everywhere in our APIs and signed messages. */
export const SOL_QUOTE = "SOL" as const;
