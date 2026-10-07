# Implementation plan

Status: living document. Written before implementation began (2026-10-07) and kept as the record of
the decisions taken.

## 1. Verified external protocol facts (2026-10-07)

Source of truth: the official `@pump-fun/pump-sdk@2.0.0` and `@pump-fun/pump-swap-sdk@1.20.0`
packages (their vendored IDLs and source), and `github.com/pump-fun/pump-public-docs`.

| Fact | Value |
| --- | --- |
| Pump bonding-curve program | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (mainnet **and** devnet) |
| PumpSwap AMM program | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Pump fee program | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |
| Mayhem program | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` |
| Create instruction | `create_v2` → **Token-2022** mint. Legacy `create` deprecated. |
| Trade instructions | `buy_v2` / `sell_v2` / `buy_exact_quote_in_v2` are the recommended unified interface; legacy `buy`/`sell` still work. |
| Quote assets | A curve can be quoted in SOL or a whitelisted / QuoteControl mint. **We support SOL-quoted curves only** and refuse others explicitly. |
| Cashback | Deprecated: `create_v2` rejects `is_cashback_enabled = true` (6082). |
| Holder-reward coins | New: `is_holder_reward` arg; creator fees go to `holderRewardsPda(mint)`. |
| Creator fee | Schedule by market-cap tier from `FeeConfig`; per-coin `creatorFeeBps` only for QuoteControl quotes. |
| Graduation | `BondingCurve.complete == true` when `real_token_reserves == 0`; `migrate` is permissionless and moves liquidity to the canonical PumpSwap pool (`canonicalPumpPoolPda(mint)`). |
| PumpSwap breaking change (Sep 30 2026) | `Pool.virtual_quote_reserves` is `i128` and can be negative. |
| Mint parameters | 6 decimals, 1,000,000,000 supply (`ONE_BILLION_SUPPLY = 1e15` raw). We still read decimals from chain. |

The SDK helper `fetchBondingCurveSummary` mentioned in some tutorials exists only in a third-party
fork, **not** the official SDK. Our adapter computes the summary itself.

## 2. Architecture decisions

### 2.1 Repository layout

npm workspaces monorepo (pnpm/Docker unavailable on the build machine; npm is universal):

```
apps/web          Next.js 16 app: UI + typed API route handlers + SSE
apps/indexer      long-running worker: Pump/PumpSwap logs → Postgres → Redis pub/sub,
                  order-expiry sweeper, settlement reconciler, finality tracker
packages/shared   numeric safety (bigint/Decimal), env config, errors, logger, KV store
packages/database Prisma 7 schema + client (pg driver adapter)
packages/auth     Sign-In-With-Solana message + verification, session tokens
packages/solana   RPC provider with failover + request dedupe, Token-2022 inspection,
                  simulation error decoding, tx helpers
packages/pump     Pump adapter: constants, vendored IDLs, venue detection, quotes,
                  instruction builders, event decoding, fee service
packages/otc      OTC protocol: canonical order schema, hashing, signed messages,
                  state machine, fee math, settlement builder + strict verifier
programs/otc-settlement  design spec for an optional on-chain program (see 2.3)
```

*Why no separate API service:* Next route handlers give typed, colocated APIs, deploy on Vercel or any
Node host, and avoid a second deployable for the MVP. The only process that must be long-lived (the
indexer, holding websocket subscriptions) is split out. All security-critical logic lives in
framework-free packages, so moving the API to a standalone service later is mechanical.

*Why no `packages/ui`:* the web app is the only UI consumer. Components live in
`apps/web/src/components/ui` until a second consumer exists.

*Why web3.js v1, not `@solana/kit`:* the official Pump SDKs (and Anchor) are typed against web3.js v1.
Using kit would force conversions at every boundary. The Pump adapter isolates this choice.

### 2.2 OTC model: signed off-chain intents + native atomic settlement

* Orders, counters, acceptances and cancellations are **signed text messages** (wallet `signMessage`)
  whose body deterministically encodes every economic field plus a domain separator (app id, cluster,
  genesis hash, protocol version). The server re-derives the exact bytes and verifies ed25519.
* Settlement is **one v0 transaction** containing the token leg (Token/Token-2022 `transferChecked`
  or `transferCheckedWithFee`), the SOL leg(s) (System transfers), a memo binding the order hash, and
  an idempotent ATA create. Both parties sign the **same message bytes**; atomicity is native Solana.
* The backend stores the compiled message bytes + hash at build time. Every signature submitted is
  verified against those exact bytes, so the backend cannot change instructions between signatures.
  Wallet-modified messages fail verification and require re-signing.
* The buyer is fee payer and signs first; the transaction id (= buyer signature) is therefore known
  before the seller signs, enabling deterministic tracking even if someone submits out-of-band.
* Blockhash expiry: a settlement is rebuilt only after the chain's block height has passed the old
  `lastValidBlockHeight` **and** the old signature is confirmed absent — the previous message can then
  never land, so two live settlement transactions for one order cannot coexist.

### 2.3 On-chain settlement program: compared, deferred

| | Native atomic tx (chosen) | Custom Anchor program |
| --- | --- | --- |
| Atomicity | Native | Native |
| Requires both parties online at settlement | Yes | No (with escrow/delegation) |
| Cancelled-order protection | Backend refuses to build; a fully co-signed tx stays valid ≤ ~60–90 s (both parties consented to those exact bytes) | Permissionless on-chain nonce invalidation |
| Single-fill | DB row locking + blockhash-expiry discipline + memo binding | On-chain fill PDA |
| Custody | None | None (if delegate-based) or escrow |
| New attack surface | None beyond SPL/System programs | Unaudited program, upgrade authority, PDA logic |

The custom program's extra guarantee mostly matters for **one-sided fills** (taker fills while maker is
offline), which this product does not need because every settlement is co-signed. An unaudited program
would add more risk than it removes. Decision: ship native settlement; keep the protocol versioned
(`version`, `settlementKind`) so a program-backed settlement can be added later. Spec in
`programs/otc-settlement/README.md`.

### 2.4 Other key choices

* Numeric safety: `bigint` for raw amounts in TS, `Decimal` (decimal.js) for display/price ratios,
  `BN` only at the Pump SDK boundary. Postgres `NUMERIC(40,0)` for raw amounts, `NUMERIC(40,18)`
  for prices. No `number` for amounts anywhere; lint rule + tests enforce it in conversions.
* Auth: SIWS-style text message, server-issued single-use nonce, ed25519 verification, opaque session
  token (hashed at rest) in an `HttpOnly; Secure; SameSite=Lax` cookie, Origin check on mutations.
* KV: Redis (ioredis) for rate limits, cache, pub/sub; in-memory fallback **only** in development.
* Metadata/images: S3-compatible storage for images (re-encoded with sharp), metadata JSON pinned via
  a provider adapter (Pinata or S3). Dev fallback: local filesystem served by the app.
* Mainnet guard: `ALLOW_MAINNET=false` blocks every transaction-building endpoint on mainnet.

## 3. Build order

1. Repo, config, database, design system, wallet connection, auth
2. Pump adapter, token discovery, token page, bonding curve + PumpSwap detection
3. Launch, buys, sells
4. OTC schema, signed orders, orderbook, private offers, counters
5. Atomic settlement, dual-signature workflow, on-chain verification
6. Portfolio, notifications, indexer, charts
7. Admin, hardening, tests, deployment docs, security review

Each phase ends with typecheck + lint + tests.

## 4. Status (end of initial build, 2026-10-07)

All seven phases implemented. Verification:

* `npm run typecheck`: all 9 workspaces clean (TypeScript 6, strict).
* `npm run lint`: clean.
* `npm test`: unit, integration (embedded Postgres + LiteSVM) and chain suites green.
* `npm run test:e2e`: Playwright journeys green (mock Wallet Standard wallet, real SVM settlement).
* Live devnet checks: Pump program accounts present; real devnet Pump transactions decoded by our event parser; live curve quotes; buy transaction built and simulated with a decoded failure reason; SIWS, nonce replay and CSRF behaviour verified over HTTP.

Not exercised live: a funded devnet trade/launch/settlement (the public faucet was unavailable during the build). The settlement path is exercised on LiteSVM, which runs the real SPL/System programs.
