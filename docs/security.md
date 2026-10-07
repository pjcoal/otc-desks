# Security model

## Assets and trust boundaries

| Asset | Where it lives | Who can move it |
| --- | --- | --- |
| User tokens and SOL | user wallets | only the user's wallet signature |
| Signed orders / acceptances / cancellations | Postgres | nobody; they authorize no transfer by themselves |
| Partially signed settlements | Postgres (message bytes + signatures) | the transaction lands only with both signatures over the stored bytes |
| Platform fees | treasury wallet (configured address) | treasury key holder (offline / multisig; never on the server) |
| Sessions | HttpOnly cookie; HMAC of token in DB | user's browser |

The server never holds a private key that can move user funds, and has no admin path to do so.

## Critical invariants and where they are enforced

| # | Invariant | Enforcement |
| --- | --- | --- |
| 1 | Private keys never touch our server | Wallet-adapter signing only. Launch mint keypairs are generated and used in the browser; only the public key is sent. |
| 2 | No trade settles without both signatures | Settlement message requires 2 signers; the server and the chain both check signatures. |
| 3 | Amounts can't change after signing | Server stores message bytes plus hash; every signature is verified over those bytes; any change → `TX_CHANGED`. The browser verifies bytes against the signed order before signing. |
| 4 | Cancelled orders can't settle | Order status checked at prepare, at each partial signature, and before submit; cancel fails live settlements; compare-and-set transitions. Residual: a tx both parties already signed lives ≤ ~90 s (disclosed). |
| 5 | Expired orders can't settle | Prepare requires ≥ 180 s of validity (longer than any blockhash); sweeper expires orders. |
| 6 | No double fill | Unique `activeLock` per order; conditional status updates; a rebuild happens only after the old blockhash is provably dead; `filledAmountRaw` checks. |
| 7 | Mint can't be swapped | Mint, program and decimals are in the signed order, re-checked against chain, encoded in the message, verified in the browser. |
| 8 | Counterparty can't be swapped | Parties derived from signed order + signed acceptance; message signers fixed; browser checks. |
| 9 | Fee can't exceed agreed fee | `min(signed, current)`; browser checks fee ≤ signed and recipient = published treasury. |
| 10 | Every trade is independently verifiable | Memo binds order hash; receipt rebuilt from chain; `docs/otc-protocol.md` lets anyone re-derive it. |

## Threat model (summary)

| Threat | Mitigation |
| --- | --- |
| Signature phishing | Human-readable signed messages that state "free, moves no funds"; distinct headers per message type; domain + network embedded; trades show decoded "you send / you receive". |
| Replay (cross-network, cross-deployment, same order) | Domain separator (host, cluster, genesis hash); unique order hash, maker nonce, signature; accept/cancel freshness (±300 s) + unique `(signer, kind, nonce)`; SIWS nonces single-use and consumed before verification. |
| Malformed / tampered transactions | Strict allowlist decoders (settlement and trade); byte-equality rebuild; server never edits messages. |
| Account / mint / amount substitution | ATAs derived, not supplied; mint/program/decimals pinned by the signed order. |
| Races and double settlement | Compare-and-set state transitions; unique DB constraints; optimistic locks on negotiation heads; integration tests run concurrent accept/prepare. |
| Stale quotes / balances | Quotes labelled with slot and time; on-chain minimum-out enforces slippage; balances re-read uncached right before building; simulation before signing. |
| Fake token metadata | Mint address always shown; on-chain name/symbol preferred; off-chain/on-chain URI mismatch warning; listing disclaimer. |
| Malicious Token-2022 extensions | Fail-closed policy (`docs/otc-protocol.md` §9). |
| Duplicate event delivery | Idempotent `(signature, eventIndex)` writes; checkpoints advance monotonically. |
| RPC poisoning / outage | Failover with circuit breaker; settlement acceptance requires the landed message hash to equal the agreed hash (a lying RPC can't make us record a different trade); `RPC_UNAVAILABLE` instead of 500s. Residual: a malicious RPC could lie about balances or confirmations. Use reputable providers and cross-check on mainnet. |
| Session hijacking | 256-bit random tokens, HMAC at rest, HttpOnly + Secure + SameSite=Lax cookies, expiry, revocation on logout and on wallet change. |
| CSRF | SameSite=Lax + strict Origin / Sec-Fetch-Site check on every mutating request. |
| XSS | React escaping; no `dangerouslySetInnerHTML`; per-request nonce CSP with `strict-dynamic`; untrusted URLs restricted to http(s); uploads served with `sandbox` CSP. |
| SQL injection | Prisma parameterization; raw SQL only via tagged templates. |
| SSRF | Metadata fetcher: https only, DNS checked at connect time against private ranges, manual re-validated redirects, size and time caps. |
| Hostile token images | Remote images are served only through `/api/img/<mint>`, which loads a known token's image (not arbitrary URLs) with the same SSRF-hardened fetcher. It accepts raster formats by magic bytes (no SVG), re-encodes the first frame to WebP with sharp under a pixel cap, and serves it with `default-src 'none'` and `nosniff`. Browsers never contact image hosts directly. |
| Rate-limit bypass | Limits keyed by IP **and** wallet; trusted-proxy-aware IP extraction; Redis required on mainnet. |
| Spam orders | Signed orders only; per-wallet open-order cap; seller holdings / buyer SOL soft checks; rate limits; acceptance-hold cap. |
| Malicious uploads | Magic-byte allowlist (no SVG), pixel cap, re-encode to WebP (strips metadata and polyglot payloads), size cap, content-addressed names. |
| Admin abuse | Admins can only view and invalidate unsettled orders; every action audited with wallet, reason and IP; no signing or fund paths exist. |

See `docs/security-review.md` for the adversarial review and its findings.
