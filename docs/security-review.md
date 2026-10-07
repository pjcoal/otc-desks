# Adversarial security review: v0.1 (2026-10-07)

Scope: authentication, order signatures, cancellation, atomic settlement, the dual-signature flow, nonce handling, blockhash refresh, database races, transaction verification, Pump trade building, the indexer, and HTTP hardening. Method: code review against the invariants in `docs/security.md`, with each fix backed by tests (unit, integration on Postgres + LiteSVM, and Playwright E2E).

**This is an internal review, not an independent audit.** An external audit of the OTC settlement path and the trade/settlement verifiers is required before mainnet (`docs/mainnet-checklist.md`).

## Findings fixed during this review

| ID | Severity | Finding | Fix | Test |
| --- | --- | --- | --- | --- |
| R-01 | High | Zod refinements ran after a failed regex, so `BigInt("1e9")` threw inside validation (a crash path on attacker input). | Refinements made total. | `protocol.test.ts` malformed payloads |
| R-02 | High | Countering a public order whose thread had already advanced bypassed the latest-revision rule. | Head check plus compare-and-set on the negotiation head. | `otc-flow.int.test.ts` latest revision |
| R-03 | High | Trade verifier allowlisted the Token and System programs without constraints: a compromised backend could add a token transfer or a SOL transfer to a third party. | Token limited to SyncNative / CloseAccount → user; System limited to transfers into the user's own WSOL ATA; ATA creation must be for the user. | `trade-verify.test.ts` |
| R-04 | High | `@solana/spl-memo@0.3` switched to an **upgradeable** memo program (`Memo4c2p…`). | Pinned the immutable canonical Memo v2 (`MemoSq4g…`, BPFLoader2); verified on devnet and mainnet. | chain tests |
| R-05 | Medium | Acceptance griefing: free signatures could lock every public order for 10 minutes. | Max 3 concurrent holds per acceptor; acceptor balance check at accept time. | `otc-flow.int.test.ts` griefing |
| R-06 | Medium | Rate-limit IP taken from the client-controlled left side of `X-Forwarded-For`. | `TRUSTED_PROXY_HOPS`, read from the right. | — |
| R-07 | Medium | Receipts for lookalike transactions (our memo format, not our settlement) showed "Verified". | `verified` requires a platform settlement with a matching message hash. | E2E receipt check |
| R-08 | Medium | `/api/tx/submit` relayed any transaction signed by the session wallet (free RPC relay). | Relays only message hashes this server prepared for that wallet within 5 minutes. | — |
| R-09 | Medium | Anonymous search persisted arbitrary non-Pump mints (DB spam). | Registry persists only mints with a Pump curve or canonical pool. | — |
| R-10 | Medium | After a trade filled, the client recomputed the fill against the post-trade total and threw (page crash). | Pre-sign verification only while collecting signatures; verifier never throws. | E2E journey |
| R-11 | Low | Unbounded JSON bodies on API routes. | 64 KB cap. | — |
| R-12 | Low | u64 overflow possible on amount query parameters. | Upper bound in `zU64`. | — |
| R-13 | Low | Public RPC 429s surfaced as 500s and were logged as unhandled. | Mapped to `RPC_UNAVAILABLE` (503). | — |
| R-14 | Low | Indexer dropped transactions on transient RPC errors, and the checkpoint could move backwards with concurrent workers. | Exponential-backoff retries; monotonic checkpoint upsert. | — |
| R-15 | Low | Admin dashboard polling wrote an audit row every 30 s. | Admin views audited at most every 10 minutes. | — |
| R-16 | Low | Expired nonces and sessions were never purged. | Hourly housekeeping in the indexer. | — |
| R-17 | Info | Order creation remained possible on a read-only mainnet deployment. | Order, counter and accept endpoints are `transactional` (blocked when `ALLOW_MAINNET=false`). | — |

## Attacks attempted that the design already resists

* **Forged maker / tampered price, quantity, mint, counterparty, fee, side**: signature fails (unit tests).
* **Cross-network replay** (devnet signature on mainnet, other deployment): domain mismatch.
* **Re-using a SIWS nonce**: consumed before verification; second use rejected (API smoke test).
* **Cross-origin POST with the victim's cookie**: `CSRF_REJECTED` (API smoke test).
* **Twelve settlement-message attacks**: extra drain instruction, amount/fee/mint/treasury/counterparty substitution, memo for another order, unknown program, seller as fee payer, duplicate compute budget, removed transfer fee. All rejected by the verifier (`settlement-tx.test.ts`).
* **Same signed transaction submitted twice**: rejected by the runtime (`settlement.chain.test.ts`).
* **Concurrent accepts and prepares**: exactly one wins (integration tests).
* **Blockhash expiry mid-signing**: settlement expires; the rebuild has a new message; old signatures → `TX_CHANGED` (integration test).
* **Cancel between signatures**: remaining signature refused; nothing settles (integration test).
* **Private deal by URL from an unrelated wallet**: restricted view, 404 on API, hidden from lists (integration + E2E).
* **Event spoofing in the indexer**: a program can't print Pump's `invoke` lines (logs are prefixed); self-CPI events need Pump's event-authority PDA signature, which only Pump has; failed transactions are skipped.

## Residual risks requiring an independent audit or operator action

1. **Signed-but-unsubmitted window.** A transaction both parties signed stays valid until its blockhash expires (~60–90 s) even if the maker cancels. This is inherent to co-signed settlement; it is disclosed in the cancel message and UI. A program-based nonce registry would remove it (`programs/otc-settlement/README.md`).
2. **Compromised web server serving modified JavaScript** could weaken the browser-side verifiers. Wallet confirmation screens remain the last line of defence. Mitigate with deployment integrity (CI-only deploys, SRI where possible, no third-party scripts).
3. **RPC trust.** Balance pre-checks and confirmation status come from the configured RPC. Use reputable providers and a fallback, and monitor divergence.
4. **Pump protocol changes.** Instruction or account changes are caught by tests on SDK upgrades, but not at runtime against an already-deployed program upgrade. Re-verify the IDL before mainnet and after any Pump announcement.
5. **Exact-in rewrite of `buy_v2` → `buy_exact_quote_in_v2`** relies on identical account lists. This is test-guarded against the installed IDL; re-verify on every SDK bump.
6. **Treasury initialisation.** A treasury holding zero lamports would make small fees fail rent checks. The builder refuses such settlements, but fund the treasury with the rent-exempt minimum.
7. **Legal and compliance** text is a template and is not legal advice.
