# Desk 404

Launch Pump.fun tokens and negotiate wallet-to-wallet block trades with atomic Solana settlement.

* **Launch** Token-2022 coins through Pump's `create_v2`, optionally with an atomic first buy. The mint key is generated in the browser.
* **Discover and trade** Pump tokens: live bonding-curve and PumpSwap data, venue auto-detection, candles from indexed trades only, and buys/sells signed in your own wallet with explicit slippage.
* **OTC desk**: public asks and bids, private offers, signed counteroffers, and a side-by-side estimate of "sell into Pump now" vs "this OTC deal".
* **Atomic settlement**: the token leg, the SOL leg and the disclosed platform fee in **one** Solana transaction that both wallets sign. No escrow and no custody.
* **Verifiable receipts** rebuilt from chain data. Portfolio, notifications, creator profiles, an operations dashboard, and a full audit log.

Non-custodial throughout: the app never sees private keys or seed phrases, and every asset movement requires the owner's wallet signature.

## Architecture

```
apps/web        Next.js 16 UI + typed API route handlers + SSE
apps/indexer    Pump/PumpSwap websocket indexer, finality pass, OTC maintenance
packages/shared numeric safety, config, errors, logger, Redis/KV, rate limits
packages/database Prisma 7 schema + migrations + demo seed
packages/auth   Sign-In-With-Solana, sessions
packages/solana RPC failover/dedupe, Token-2022 inspection, tx helpers
packages/pump   Pump adapter (the only code that touches Pump SDKs)
packages/otc    OTC protocol + settlement builder/verifier + server services
packages/market token registry, discovery, candles, SSRF-safe metadata
programs/otc-settlement  design spec for an optional on-chain program
docs/           architecture, protocol, security, Pump integration, deployment, checklists
```

Read [`docs/architecture.md`](docs/architecture.md) first. The OTC wire format is specified in [`docs/otc-protocol.md`](docs/otc-protocol.md).

## Tech stack

TypeScript (strict) · Next.js 16 / React 19 · Tailwind CSS 4 · Radix primitives · TanStack Query · Zustand (toasts, settings) · `@solana/web3.js` 1.x + `@solana/spl-token` (Token-2022) · Solana Wallet Adapter with Wallet Standard auto-discovery · `@pump-fun/pump-sdk` 2.0 + `@pump-fun/pump-swap-sdk` 1.20 · PostgreSQL + Prisma 7 · Redis (ioredis) · Server-Sent Events · Vitest · LiteSVM (in-process Solana runtime) · Playwright · Docker.

## Local setup

Requirements: Node ≥ 22.12 (developed on 24), npm 11. Docker is optional.

```bash
npm install
cp .env.example apps/web/.env.local     # edit: SESSION_SECRET, PLATFORM_TREASURY_WALLET, DATABASE_URL
cp apps/web/.env.local apps/indexer/.env
```

### Database

**Option A, no Docker** (real PostgreSQL from the `embedded-postgres` package):

```bash
npm run db:embedded           # keeps running; DATABASE_URL=postgresql://otc:otc@localhost:54329/otc
```

**Option B, Docker:** `docker compose up -d postgres redis` → `DATABASE_URL=postgresql://otc:otc@localhost:5432/otc`, `REDIS_URL=redis://localhost:6379`.

Then:

```bash
npm run db:generate           # Prisma client
npm run db:deploy             # apply migrations (or `npm run db:migrate` while developing)
```

### Redis

Optional locally: without `REDIS_URL` an in-memory store is used (single process; live updates from the indexer won't reach the web app). Required on mainnet.

### Run

```bash
npm run dev                   # web on http://localhost:3000
npm run indexer               # second terminal: indexer (devnet firehose by default)
```

## Environment variables

All variables are documented in [`.env.example`](.env.example) and validated at startup by [`packages/shared/src/config.ts`](packages/shared/src/config.ts). Essentials:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public origin; part of every signed-message domain separator |
| `SESSION_SECRET` | HMAC key for session tokens (≥ 32 chars) |
| `DATABASE_URL`, `REDIS_URL` | Postgres / Redis |
| `SOLANA_CLUSTER` | `devnet` (default), `mainnet-beta`, `testnet`, `localnet` |
| `SOLANA_RPC_URL`, `SOLANA_RPC_FALLBACK_URL`, `SOLANA_WS_URL` | Server RPC with failover |
| `PUBLIC_SOLANA_RPC_URL` | Browser-safe RPC for wallet operations |
| `ALLOW_MAINNET` + `MAINNET_CHECKLIST_COMPLETED` | Mainnet kill switch (off by default) |
| `PLATFORM_TREASURY_WALLET`, `OTC_PLATFORM_FEE_BPS`, `OTC_FEE_MODE`, `OTC_REFERRAL_SHARE_BPS` | Disclosed OTC fee economics |
| `METADATA_PROVIDER` (+ `S3_*` or `METADATA_API_KEY`) | Token image/metadata storage |
| `IPFS_GATEWAY_URL`, `IPFS_FALLBACK_GATEWAYS` | IPFS gateways, tried in order (ipfs.io no longer serves plain HTTP reliably) |
| `ADMIN_WALLETS` | Wallets allowed into `/admin` |
| `INDEXER_MODE` | `firehose` (devnet) or `tracked` (mainnet) |

## Solana devnet setup

1. Set your wallet (Phantom / Solflare / Backpack) to **Devnet**. The app's network badge shows the cluster it targets.
2. Get devnet SOL from <https://faucet.solana.com> (the RPC `requestAirdrop` is often rate-limited).
3. Find devnet Pump tokens: run the indexer, or `npx tsx scripts/find-devnet-pump-token.ts`. You can also launch your own at `/launch`.
4. Fund `PLATFORM_TREASURY_WALLET` with ≥ 0.001 SOL so fee transfers succeed.

### Wallets

Any Wallet Standard wallet is detected automatically. Connecting doesn't sign anything. "Sign in" asks for a free message signature (Sign-In With Solana). Switching accounts in the wallet signs you out, so a session never acts for a different wallet than the one connected.

## Pump integration

See [`docs/pump-integration.md`](docs/pump-integration.md). Highlights: program ids and discriminators are pinned and test-guarded against the SDK; curve buys use `buy_exact_quote_in_v2` (exact SOL in, minimum tokens out); venue detection covers bonding curve, PumpSwap, and complete-but-not-migrated; only SOL-quoted markets are tradable.

## Running the indexer

`npm run indexer`. It resumes from `IndexerCheckpoint`, backfills up to `INDEXER_BACKFILL_LIMIT` signatures, subscribes to Pump and PumpSwap logs, retries transient RPC failures with backoff, promotes rows to finalized, removes rows from dropped forks, refreshes market snapshots, and runs OTC maintenance (expiry, acceptance-hold release, settlement reconciliation) every 15 s. Public RPCs rate-limit aggressively, so use a dedicated RPC beyond light devnet testing.

## Testing

```bash
npm run typecheck
npm run lint
npm test                      # unit + integration + chain (Vitest)
npm run test:unit             # pure logic: hashing, signatures, fees, numeric, Pump codecs, verifiers
npm run test:integration      # real Postgres (embedded) + LiteSVM: full OTC lifecycle, races, replays
npm run test:chain            # settlement executed on a real SVM: atomicity, balances, expiry, signers
npm run test:e2e              # Playwright: mocked Wallet Standard wallet, offer → counter → accept → co-sign → receipt
```

Integration tests start their own PostgreSQL (`embedded-postgres`) on port 54330, or use `TEST_DATABASE_URL`. E2E boots Postgres on 54331, builds the app, and serves it on port 3100 in a guarded LiteSVM mode (`SOLANA_CLUSTER=localnet` only).

Live devnet smoke test against a running app: `MINT=<devnet pump mint> npx tsx scripts/smoke-api.ts` (SIWS sign-in, nonce replay, CSRF, buy preparation with simulation).

## Deployment

See [`docs/deployment.md`](docs/deployment.md). Summary: `docker build --target web` / `--target indexer`, managed Postgres + Redis, two RPC providers, one indexer replica, migrations as a release step.

## Security notes

* Threat model and invariants: [`docs/security.md`](docs/security.md). Adversarial review and fixes: [`docs/security-review.md`](docs/security-review.md).
* Every signed message is human-readable, domain-separated (host + cluster + genesis hash) and rebuilt by the server from the payload before verification.
* Settlement messages are stored as exact bytes; signatures over anything else are rejected (`TX_CHANGED`). Browsers verify the bytes against the maker-signed order before the wallet prompt.
* Fail-closed Token-2022 policy: transfer hooks, permanent delegates, freeze authority, pausable-paused, confidential, non-transferable, interest-bearing and scaled-UI mints are refused.
* The app holds no keys capable of moving user funds; admins can only invalidate unsettled orders, and every admin action is audited.

## Mainnet checklist

Mainnet stays read-only until [`docs/mainnet-checklist.md`](docs/mainnet-checklist.md) is complete. Configuration refuses `ALLOW_MAINNET=true` without `MAINNET_CHECKLIST_COMPLETED=yes`, a fallback RPC, Redis, https, a real session secret, and simulation on. **An independent audit of the OTC settlement path is required before enabling mainnet.**
