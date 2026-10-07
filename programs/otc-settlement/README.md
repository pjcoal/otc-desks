# OTC settlement program (design, not deployed)

Version 1 settles with a plain co-signed transaction (System + Token programs only); see `docs/otc-protocol.md`. This document specifies an optional Anchor program for a future version, and why it isn't in v1.

## What it would add

| Capability | v1 (co-signed tx) | With program |
| --- | --- | --- |
| Atomic exchange | ✔ native | ✔ |
| Exact terms enforced | ✔ both parties sign the bytes | ✔ program checks the order hash |
| Single fill | ✔ DB lock + blockhash-expiry discipline | ✔ on-chain `Fill` PDA per order hash |
| Fee cap | ✔ in signed message | ✔ enforced by program |
| Binding cancellation | ✖ off-chain; signed txs live ≤ 90 s | ✔ maker writes `Nonce` PDA; program rejects |
| Fill while maker offline | ✖ both must sign | ✔ maker pre-authorizes via ed25519 instruction + token delegate / escrow |
| Attack surface | System/Token programs only | new unaudited program + upgrade authority |

## Sketch

* `register_order` is not needed: orders stay off-chain. The program verifies the maker's ed25519 signature over the v1 canonical message with an `Ed25519SigVerify` precompile instruction in the same transaction, and recomputes `orderHash` from passed fields.
* Accounts: `NonceState { maker, nonce, cancelled }` at PDA `["nonce", maker, nonce]`; `FillState { order_hash, filled }` at PDA `["fill", order_hash]`.
* `cancel(nonce)`, signed by the maker, sets `cancelled = true` (permissionless invalidation).
* `settle(order_fields, fill)`, signed by the taker, checks the precompile, nonce not cancelled, expiry, `filled + fill ≤ total`, then transfers tokens via delegate or escrow and SOL via CPI, transfers the fee to a config-held treasury bounded by the signed fee, and increments `filled`.

## Decision

The program's main benefits are binding cancellation and offline-maker fills. Neither is required for co-signed block trades, and the 60–90 s exposure window is disclosed to users. An unaudited custom program holding delegate authority would add more risk than it removes. Revisit when one-sided fills become a product requirement, and budget for an independent audit before deployment.
