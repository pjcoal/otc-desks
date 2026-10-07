# Mainnet launch checklist

Mainnet transactions stay disabled until **all** of the following are true **and** `ALLOW_MAINNET=true` plus `MAINNET_CHECKLIST_COMPLETED=yes` are set. Config validation refuses mainnet without a fallback RPC, Redis, an https `APP_URL`, a real `SESSION_SECRET`, simulation enabled, and demo mode off.

## Infrastructure
- [ ] Production RPC (paid, keyed) in `SOLANA_RPC_URL`; websocket endpoint in `SOLANA_WS_URL`
- [ ] Fallback RPC from a **different provider** in `SOLANA_RPC_FALLBACK_URL`
- [ ] `PUBLIC_SOLANA_RPC_URL` is a browser-safe endpoint (no secret key)
- [ ] Managed Postgres with automated backups + point-in-time recovery; restore drill done
- [ ] Managed Redis (`REDIS_URL`); persistence/HA as appropriate
- [ ] Rate limits reviewed (`packages/shared/src/ratelimit.ts`) and `TRUSTED_PROXY_HOPS` matches the proxy chain
- [ ] `SESSION_SECRET` unique, ≥ 32 random bytes, stored in a secret manager
- [ ] Domain configured, HTTPS only, HSTS active (`APP_URL=https://…`)
- [ ] Object storage public URLs live; `METADATA_PROVIDER` ≠ `local`
- [ ] Indexer running with `INDEXER_MODE=tracked`, exactly one replica

## Economics and identities
- [ ] `PLATFORM_TREASURY_WALLET` confirmed by two people against a hardware-wallet/multisig address; funded with rent-exempt minimum
- [ ] `OTC_PLATFORM_FEE_BPS`, `OTC_FEE_MODE`, `OTC_REFERRAL_SHARE_BPS` approved and reflected on the Fees page
- [ ] `ADMIN_WALLETS` confirmed (hardware wallets)
- [ ] `PLATFORM_TOKEN_MINT` (if any) verified; no functionality depends on its price

## Protocol verification
- [ ] Pump, PumpSwap, Pump fees and Mayhem program ids re-verified on mainnet (`docs/pump-integration.md`)
- [ ] Pump SDK/IDL re-checked for breaking changes since 2026-10-07; `npm run test:unit` green on the pinned versions
- [ ] Real mainnet quotes compared with the official Pump UI for a curve token and a graduated token
- [ ] Token-2022 handling tested with a transfer-fee token, a hooked token (must be blocked), and a frozen account (must be blocked)
- [ ] `SIMULATE_TRANSACTIONS=true`

## Security
- [ ] Independent audit of `packages/otc` (settlement builder, verifier, server services) and `packages/pump` trade verifier; findings resolved
- [ ] `docs/security-review.md` residual risks accepted in writing
- [ ] Monitoring and alerting: error webhook/Sentry, RPC failure rate, indexer lag, failed settlements
- [ ] Logs ship to retained storage; no secrets in logs (pino redaction verified)
- [ ] Dependency audit (`npm audit`) reviewed; lockfile committed

## Product and legal
- [ ] Terms, Privacy, Risk Disclosure, Fees and Listing Disclaimer reviewed by counsel
- [ ] Region restrictions decided and configured (`BLOCKED_REGIONS`)
- [ ] `APP_NAME` / branding final; no placeholder text

## Operations
- [ ] Incident procedure written: who can set `ALLOW_MAINNET=false` (instant read-only kill switch), communication channel, RPC failover steps, how to invalidate orders for a compromised mint (`/admin`)
- [ ] Small real-money dry run: launch, buy, sell, OTC ask, counter, settle, receipt verification, with two team wallets
- [ ] Only then: set `ALLOW_MAINNET=true` and `MAINNET_CHECKLIST_COMPLETED=yes`
