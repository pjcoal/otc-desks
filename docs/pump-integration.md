# Pump.fun integration

Verified on **2026-10-07** against `@pump-fun/pump-sdk@2.0.0`, `@pump-fun/pump-swap-sdk@1.20.0`, `github.com/pump-fun/pump-public-docs`, and on-chain program accounts on devnet and mainnet-beta.

## Constants (`packages/pump/src/constants.ts`)

| Item | Value |
| --- | --- |
| Pump (bonding curve) | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (mainnet and devnet) |
| PumpSwap (AMM) | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Pump fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |
| Mayhem | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` |
| `create_v2` | `[214,144,76,236,95,139,49,180]` |
| `buy_v2` / `buy_exact_quote_in_v2` / `sell_v2` | `[184,23,…]` / `[194,171,…]` / `[93,246,…]` |
| PumpSwap `buy` / `sell` | `[102,6,…]` / `[51,230,…]` |

`packages/pump/src/protocol.test.ts` asserts that every constant equals what the installed SDK and IDL export, and that `buy_v2` and `buy_exact_quote_in_v2` still share an identical account list.

## What the adapter does

| Feature | Implementation |
| --- | --- |
| Venue detection | One `getMultipleAccounts` for mint + `bondingCurvePda(mint)` + `canonicalPumpPoolPda(mint)`. Live curve → `PUMP_BONDING_CURVE`; canonical pool → `PUMPSWAP`; complete curve without a pool → `UNKNOWN` ("awaiting migration"); otherwise `UNKNOWN`. Non-SOL quote mints are shown but not tradable. |
| Price, market cap, progress | Curve: virtual reserves; market cap via the SDK's `bondingCurveMarketCap`; progress = sold share of `Global.initialRealTokenReserves`. Pool: `(quoteReserve + virtualQuoteReserves) / baseReserve`. `virtualQuoteReserves` is signed (i128) since 2026-09-30. |
| Buy (curve) | SDK `buyV2Instructions` builds accounts; the adapter rewrites the data to **`buy_exact_quote_in_v2(spendable_sol, min_tokens_out)`**, so the user spends exactly the SOL they typed and gets a minimum token amount. The SDK has no builder for this instruction; the identical account list is test-guarded. |
| Sell (curve) | SDK `sellV2Instructions` with slippage 0 and our own integer-bps minimum. The adapter fails closed if the encoded arguments differ from ours. |
| Buy/sell (PumpSwap) | SDK pure quote functions (`buyQuoteInput`, `sellBaseInput`) plus `PUMP_AMM_SDK.buyInstructions` / `sellInstructions` (exact-out buy with max SOL; exact-in sell with min SOL). |
| Fees | SDK `computeFeesBps` (market-cap tiers from `FeeConfig`) for display; the program charges on chain. Holder-reward coins label creator fees as paid to holders. |
| Launch | `create_v2` (Token-2022) or `createV2AndBuyV2Instructions` with the buy rewritten to exact-SOL-in. The mint keypair is generated in the browser. Holder-reward coins are optional. Cashback is deprecated by Pump and not offered. |
| Events | `Program data:` logs (attributed via the invoke stack) and `emit_cpi!` inner instructions, decoded with the SDK's layout-tolerant decoders (CreateEvent, TradeEvent, CompleteEvent, CreatePoolEvent, BuyEvent, SellEvent). Failed transactions are ignored. |
| Errors | IDL error codes mapped to user-facing codes (`TooMuchSolRequired`/`TooLittleSolReceived` → "Pump quote changed beyond your slippage setting", etc.). |

## Optional discovery source (mainnet)

`PUMP_DISCOVERY_API=true` lets the registry seed token lists from Pump.fun's website backend (`frontend-api-v3.pump.fun/coins`, sorted by last trade, creation and market cap), at most once a minute (Redis lock), via `packages/pump/src/discovery.ts`. That API is **unofficial and undocumented**: it can change or block traffic without notice, and it serves mainnet only. Records are validated as untrusted input (malformed, banned and NSFW records are dropped), prices are derived from its integer curve reserves, and discovery rows carry `slot = 0`. Any token page visit, or any OTC action on a discovery-only token, re-reads the mint and market from chain before anything is signed. If the API fails, lists simply stop updating.

A chain snapshot younger than 10 minutes is never replaced by discovery data. An older one is replaced and reset to `slot = 0`, so the next signing path re-reads chain again.

## Listing rules and USD figures (mainnet)

Discovery sections (Trending, New, Near graduation, Recently graduated) and name search list only:

* coins younger than `LISTING_RECENT_HOURS` (default 72) whose market cap is at least `LISTING_MIN_MCAP_USD` (default $500,000);
* older coins with at least `LISTING_MIN_VOLUME_USD` (default $100,000) of 24h volume measured in the last 2 hours, either by DexScreener or by our own indexer;
* coins launched through this site, always.

"Launched here" and the OTC-activity sections reflect activity on this site and are not filtered. A token page is always reachable by mint, and pasting a mint into search always resolves it. On test clusters nothing is filtered and amounts stay in SOL.

* **SOL/USD** comes from the on-chain Pyth sponsored feed `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`, read through our own RPC (`packages/solana/src/pyth.ts`).
  * The reader checks the owner program (`rec5EKMG…`), the account discriminator and the feed id. It rejects prices older than 5 minutes and confidence intervals wider than 2%.
  * The price is cached for 30 seconds. A last good price is kept for 6 hours.
  * Without a price, the USD floors can't be converted to lamports. Only DexScreener's USD volume rule then applies (fail closed), and the UI shows SOL.
* **24h volume**: `DEXSCREENER_API=true` enables `packages/market/src/dexscreener.ts`.
  * It calls the public `/tokens/v1/solana/{up to 30 mints}` endpoint after each discovery run: the coins currently listed on volume first (so they drop out when activity fades), then the coins just discovered, with at most 240 coins per run.
  * Volume is summed over every pair where the coin is the base token, in integer cents.
  * It is written without touching `MarketState.updatedAt`, so it can't make a price look fresh.

USD figures (market cap, volume) are for display and listing only. Quotes, OTC amounts, fees and settlement are always in lamports and token base units.

## Upgrading Pump

1. Bump the SDK versions in `packages/pump/package.json`.
2. `npm run test:unit`. Constant, discriminator and account-list guards fail loudly if anything moved.
3. Read the SDK README changelog. Update `constants.ts`, the adapter, and `docs/pump-integration.md`.
4. Run the devnet smoke test: `MINT=<devnet pump mint> npx tsx scripts/smoke-api.ts` against a running app. `scripts/find-devnet-pump-token.ts` lists recent devnet Pump mints.

## Known limits

* Only SOL-quoted markets are supported (USDC/QuoteControl curves are displayed but not tradable).
* PumpSwap buys use exact-out with max-in (SDK builder). A `buy_exact_quote_in` builder for PumpSwap could be added like the curve rewrite.
* Holder counts are not computed (too expensive on mainnet). The Holders tab shows the largest accounts instead.
