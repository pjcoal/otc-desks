# Deployment

## Topology

| Component | Suggested host | Notes |
| --- | --- | --- |
| Web (UI + API) | Vercel, Fly, Railway, ECS | Node runtime. Stateless; scale horizontally. The SSE endpoint holds connections, so on serverless platforms clients reconnect automatically when a function times out. |
| Indexer | Fly / Railway / ECS (always-on, 1 replica) | Holds websocket subscriptions and timers. Exactly **one** replica per cluster. |
| Postgres | Managed (Neon, RDS, Railway, Supabase) | PITR backups enabled. `DATABASE_POOL_SIZE` × replicas ≤ the server's connection limit (use PgBouncer if needed). |
| Redis | Managed (Upstash, ElastiCache, Railway) | Required on mainnet: rate limits, locks, live updates. |
| Object storage | S3 / R2 / MinIO, or Pinata (IPFS) | Public-read bucket for token images; metadata URIs must be ≤ 200 chars. |
| Solana RPC | Helius / Triton / QuickNode + a different-provider fallback | `SOLANA_RPC_URL` may contain a key (server only). `PUBLIC_SOLANA_RPC_URL` is shown to browsers. |

## Steps

1. **Provision** Postgres, Redis, storage and RPC endpoints.
2. **Configure** environment variables from `.env.example` on both web and indexer. Generate `SESSION_SECRET` with `openssl rand -base64 48`.
3. **Migrate** from a release job: `npm run db:deploy`. The web image also runs it at boot. In multi-replica setups, prefer a single release step.
4. **Build and run**:
   * Docker: `docker build --target web -t otc-web .` and `docker build --target indexer -t otc-indexer .`
   * Vercel (web): root `apps/web`; install `npm ci` at repo root; build `npm run db:generate && npm run build -w @app/web`; set env vars. Run the indexer elsewhere.
5. **Domain**: set `APP_URL` to the exact origin the site is served from (e.g. `https://www.desk404.fun`). It is the CSRF origin and part of every signed message, so change it only before orders exist. Production requests to `*.vercel.app` redirect to it. `LAUNCH_LINK_URL` (e.g. `https://desk404.fun`) is the link written into every launched coin's metadata.
6. **Fund the treasury** wallet with at least the rent-exempt minimum (0.00089088 SOL) so small fee transfers succeed.
7. **Smoke test**: `GET /api/health` (db, kv, rpc, indexer lag); sign in; post and cancel a devnet order; `MINT=<pump mint> npx tsx scripts/smoke-api.ts`.
8. **Monitor**: `ERROR_WEBHOOK_URL` (or wire Sentry/Datadog in `apps/web/src/instrumentation.ts` and the indexer). Ship stdout JSON logs (pino) to your log store. Watch the `/admin` RPC, indexer-lag and failed-settlement panels.

## Region restrictions

Set `BLOCKED_REGIONS=US,…` (ISO country codes). `proxy.ts` reads `x-vercel-ip-country` or `cf-ipcountry`. Blocked visitors can still read the terms, privacy and risk pages; API calls return 451. Make sure your CDN sets one of those headers.

## Scaling notes

* RPC is the bottleneck. The provider de-duplicates identical in-flight reads and micro-caches account reads for 750 ms; settlement validation uses the uncached connection.
* Use `INDEXER_MODE=tracked` on mainnet (only mints in the database).
* Discovery pages are database-only; MarketState refreshes are driven by the indexer.
