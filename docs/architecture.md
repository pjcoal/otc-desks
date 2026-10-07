# Architecture

```
                 ┌──────────────────────── Browser ─────────────────────────┐
                 │ Next.js UI · Wallet Standard (Phantom/Solflare/Backpack) │
                 │ independent verifiers: verifyTradeMessage, checkSettlement│
                 └───────────────┬───────────────────────────▲──────────────┘
                     JSON + SSE  │ (same-origin, CSRF-checked)│ signed messages / txs
                 ┌───────────────▼───────────────────────────┴──────────────┐
                 │ apps/web: Next.js route handlers (Node runtime)           │
                 │  route() wrapper: origin check · session · rate limit ·   │
                 │  mainnet guard · Zod · error mapping                      │
                 └──┬─────────────┬───────────────┬──────────────┬──────────┘
                    │             │               │              │
              packages/otc  packages/market  packages/pump  packages/auth
              (protocol +   (token registry, (only module     (SIWS, sessions)
               settlement)   queries, SSRF-   that touches
                    │        safe metadata)   Pump SDKs)
                    └─────────────┬───────────────┘
                          packages/solana (RPC failover + dedupe, Token-2022, tx tools)
                                  │
         Postgres (Prisma) ◄──────┼──────► Solana RPC (primary → fallback)
                ▲                 │                 │ websocket logs
                │          Redis (rate limits,      ▼
                │           locks, pub/sub) ◄── apps/indexer: logs → getTransaction →
                │                 ▲               event parser → Postgres; finality pass;
                └─────────────────┴────────────── OTC maintenance sweeper
```

## Packages

| Package | Responsibility | Runs in |
| --- | --- | --- |
| `@app/shared` | bigint/Decimal numeric safety, error catalog, env config (Zod), logger, KV store, rate limiter | both (`/server` entry is Node-only) |
| `@app/database` | Prisma 7 schema, migrations, client (pg driver adapter), demo seed | Node |
| `@app/auth` | SIWS message format, ed25519 verification, session tokens | both (`/server` Node-only) |
| `@app/solana` | RPC provider (failover, in-flight dedupe, micro-cache), Token-2022 inspection and OTC safety policy, simulation error decoding, v0 compile helpers | both (`/server` Node-only) |
| `@app/pump` | **Pump adapter**: constants, venue detection, quotes, buy/sell/create builders, event decoding, fee breakdown, browser-safe instruction codecs and verifier | both (`/client` browser-safe) |
| `@app/otc` | OTC protocol (schema, canonical hashing, messages, amounts, state machine, settlement builder and verifier) plus `/server` services (orders, settlement, receipts) | both |
| `@app/market` | token registry (chain → DB), discovery, search, candles, SSRF-hardened metadata fetch | Node |
| `apps/web` | UI, API, SSE | Node / browser |
| `apps/indexer` | websocket indexing, finality, OTC maintenance, housekeeping | Node (long-lived) |

## Why this shape

* **One deployable for UI and API.** Route handlers keep APIs typed and colocated, and deploy anywhere Next runs. Security-critical logic lives in framework-free packages, so the API can move to a separate service without rewriting it.
* **The indexer is separate** because it holds websocket subscriptions and timers, which serverless platforms can't host.
* **The Pump adapter is the only Pump dependency.** A protocol upgrade (new IDL, renamed instruction, new fee schedule) changes `packages/pump` and its tests. CI fails if SDK program ids, discriminators or account layouts drift from what we pinned.
* **Isomorphic verification.** Settlement and trade verifiers run in the browser so a compromised backend can't change what a wallet signs without the UI refusing.

## Data flow: an OTC trade

1. Maker signs an order message → `POST /api/otc/orders` → verified, persisted (`OPEN`), audited, notification sent.
2. Counterparty counters (`/counter`, a new signed order) or accepts (`/accept`, a signed acceptance). Acceptance reserves the order for 10 minutes (`ACCEPTED`).
3. `POST /api/otc/settlement/prepare` → balance and token re-validation → deterministic v0 message → self-verify → simulate → persisted under a unique per-order lock (`SETTLEMENT_READY`).
4. Buyer, then seller, sign through `/partial-signature`. The server checks that the message hash is unchanged and verifies each signature.
5. Server broadcasts. Reconciliation (request path and indexer sweeper) confirms by matching the landed message hash, then sets `FILLED`.
6. `/trade/[signature]` rebuilds the receipt from chain data.

## Live data

The indexer subscribes to `logsSubscribe` for the Pump and PumpSwap programs (`confirmed`), queues signatures, fetches each transaction, and decodes `emit!` log events and `emit_cpi!` inner-instruction events with the official IDL coders. Writes are idempotent on `(signature, eventIndex)`. A checkpoint per program enables bounded catch-up after restarts. A finality pass promotes rows to `FINALIZED` and deletes rows whose signature vanished (dropped forks). Changed mints trigger a market refresh and a Redis publish, and the web SSE endpoint forwards those as cache-invalidation hints. Clients always refetch from the API and never trust stream payloads.

On mainnet set `INDEXER_MODE=tracked` to index only mints already in the database (launched here, looked up, or traded OTC). The Pump firehose is too large for a general-purpose RPC.

## Numeric safety

Raw amounts are `bigint` in TypeScript, `NUMERIC(40,0)` in Postgres, and `BN` only at the Pump SDK boundary. Prices are `Decimal` / `NUMERIC(40,18)`. User input goes through `parseUnits`, which rejects excess precision instead of rounding. ESLint bans `parseFloat`/`parseInt`. Display formatting truncates and never rounds up.
