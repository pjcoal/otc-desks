# OTC protocol, version 1

This document specifies the off-chain order protocol and the on-chain settlement transaction precisely enough for an independent engineer to build a compatible client or verifier. The reference implementation is `packages/otc` (isomorphic TypeScript). Wherever this document and the code disagree, that is a bug; the test suite in `packages/otc/src/__tests__` pins the behaviour described here.

Terms: **maker** signs an order; **taker / acceptor** accepts it; **seller** sends tokens; **buyer** sends SOL. All integers are unsigned; all "raw" amounts are base units (lamports for SOL, `10^-decimals` for tokens).

---

## 1. Design summary

* Orders, counteroffers, acceptances and cancellations are **signed messages** (wallet `signMessage`), not transactions. Signing moves no funds and creates no on-chain state.
* Settlement is **one Solana v0 transaction** carrying both legs. Both parties sign the **same message bytes**. Solana executes a transaction atomically, so either both legs settle or neither does.
* There is no escrow and no custom on-chain program. See §11 for the trade-off.

## 2. Domain separator

Every signed payload carries:

| Field | Meaning |
| --- | --- |
| `environment` | Host of the deployment's `APP_URL` (e.g. `otc.example.com`, `localhost:3000`). |
| `network` | `devnet` \| `mainnet-beta` \| `testnet` \| `localnet` |
| `genesisHash` | Base58 genesis hash of the cluster. mainnet-beta `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`, devnet `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. |

A verifier MUST reject any payload whose three domain fields are not exactly its own. This prevents replay across deployments and clusters.

## 3. Canonical serialization and hashing

`canonicalJson(value)`:

* objects: keys sorted by UTF-16 code unit (`Array.prototype.sort` default), emitted as `{"k":v,...}` with no whitespace;
* arrays: `[a,b]`;
* strings: `JSON.stringify` escaping;
* numbers: only JavaScript safe integers (`|n| ≤ 2^53−1`); **all amounts are decimal strings**;
* `true`, `false`, `null` literally;
* `undefined`, floats, `NaN`, `Infinity` and non-plain objects are errors.

`hash(payload) = lowercase_hex(SHA-256(UTF-8(canonicalJson(payload))))`, 64 hex chars. Each payload has a `type` field, so hashes of different message kinds cannot collide.

## 4. Order payload (`type: "otc-order"`)

| Field | Type | Rules |
| --- | --- | --- |
| `type` | `"otc-order"` | |
| `version` | `1` | |
| `orderId` | 32 lowercase hex | 128 random bits, chosen by the maker |
| `environment`, `network`, `genesisHash` | see §2 | |
| `makerWallet` | base58 pubkey | signer |
| `takerWallet` | base58 \| `null` | `null` = public; otherwise only this wallet may accept. ≠ maker |
| `tokenMint` | base58 | |
| `tokenProgram` | base58 | Token or Token-2022 program id that owns the mint |
| `tokenDecimals` | int 0–18 | must equal the mint's decimals |
| `side` | `"BUY"` \| `"SELL"` | the maker's side |
| `tokenAmountRaw` | canonical uint string, 1 … u64::MAX | no leading zeros |
| `quoteMint` | `"SOL"` | canonical representation of native SOL |
| `quoteAmountRaw` | canonical uint string, 1 … u64::MAX | lamports for the whole order |
| `createdAt`, `expiresAt` | unix seconds | `expiresAt > createdAt` |
| `nonce` | 32 lowercase hex | unique per maker |
| `salt` | 32 lowercase hex | random |
| `allowPartialFill` | bool | |
| `minimumFillAmountRaw` | uint string | `= tokenAmountRaw` when partial fills are off; else `1 ≤ min ≤ tokenAmountRaw` |
| `platformFeeBps` | int 0–1000 | must equal the deployment's fee at publication |
| `feeMode` | `"SELLER_PAYS"` \| `"BUYER_PAYS"` \| `"SPLIT"` | must equal the deployment's mode at publication |
| `parentOrderHash` | 64 hex \| `null` | set on counteroffers (§7) |
| `note` | string ≤ 280 \| `null` | NFC-normalised; no C0/C1 control characters, no U+2028/U+2029 |
| `metadataVersion` | `1` | |

`orderHash = hash(orderPayload)`.

## 5. Signed message text

Wallets sign the UTF-8 bytes of a human-readable text derived **deterministically** from the payload: no locale, clock or configuration is involved. Lines are joined with `\n` (LF), with no trailing newline. Formatting helpers:

* `tokens(raw, d)` = `formatUnits(raw, d, grouped)` + ` (raw <raw>, <d> decimals)`. Grouping uses `,` every three digits of the whole part; fractional zeros are trimmed and nothing is rounded.
* `sol(raw)` = `formatUnits(raw, 9, grouped)` + ` SOL (<raw> lamports)`.
* `iso(t)` = `new Date(t*1000).toISOString()` with `.000Z` replaced by `Z`.

### 5.1 Order

```
OTC <order|counteroffer> — <environment>
Signing publishes this order. It is free and does not move any funds.
Funds move only if you later approve a settlement transaction.

Side: <BUY|SELL>
Token mint: <tokenMint>
Token program: <tokenProgram>
Token amount: <tokens(tokenAmountRaw, tokenDecimals)>
Total price: <sol(quoteAmountRaw)>
Maker: <makerWallet>
Counterparty: <takerWallet | "anyone (public order)">
Partial fills: <"allowed, minimum " + tokens(minimumFillAmountRaw) | "not allowed">
Platform fee: <platformFeeBps> bps, <"paid by seller"|"paid by buyer"|"split 50/50">
Created: <iso(createdAt)>
Expires: <iso(expiresAt)>
[Counter to order: <parentOrderHash>]        (only when parentOrderHash ≠ null)
[Note: <note>]                                (only when note ≠ null)

Order ID: <orderId>
Nonce: <nonce>
Salt: <salt>
Domain: <environment>
Network: <network> (genesis <genesisHash>)
Order hash: <orderHash>
```

The header word is `counteroffer` iff `parentOrderHash` is non-null. The em dash is U+2014.

### 5.2 Acceptance (`type: "otc-accept"`)

Payload fields: `type`, `version`, domain fields, `orderHash`, `acceptor`, `fillAmountRaw`, `quoteAmountRaw` (the gross price for this fill, §8.1), `nonce` (32 hex), `signedAt` (unix s).

```
OTC acceptance — <environment>
Signing records your acceptance. It is free and does not move any funds.
You will review and approve the exact settlement transaction next.

Order hash: <orderHash>
Accepting wallet: <acceptor>
Token mint: <order.tokenMint>
You <buy|sell>: <tokens(fillAmountRaw, order.tokenDecimals)>
You <pay|receive> (before platform fee): <sol(quoteAmountRaw)>
Signed at: <iso(signedAt)>
Nonce: <nonce>
Domain: <environment>
Network: <network> (genesis <genesisHash>)
Acceptance hash: <hash(acceptPayload)>
```

`buy`/`pay` when the order's side is `SELL`, otherwise `sell`/`receive`.

### 5.3 Cancellation (`type: "otc-cancel"`)

Payload fields: `type`, `version`, domain fields, `orderHash`, `maker`, `nonce`, `signedAt`.

```
OTC cancellation — <environment>
Signing cancels your order. It is free and does not move any funds.
A settlement transaction you have ALREADY signed stays valid until its blockhash expires (about 60–90 seconds).

Cancel order: <orderHash>
Maker: <maker>
Signed at: <iso(signedAt)>
Nonce: <nonce>
Domain: <environment>
Network: <network> (genesis <genesisHash>)
Cancellation hash: <hash(cancelPayload)>
```

## 6. Signature verification

`signature` is the base58 encoding of a 64-byte ed25519 signature by the relevant wallet over the UTF-8 message text from §5. A verifier:

1. validates the payload against §4 (or the accept/cancel schema): exact field set, canonical integer strings, ranges, text rules;
2. checks the domain (§2);
3. **rebuilds the message text from the payload**; text supplied by a client is never trusted;
4. verifies ed25519 against `makerWallet` / `acceptor` / `maker`.

Server-side freshness and replay rules:

* Orders: `|createdAt − now| ≤ 300 s`; `expiresAt − now` within the deployment's `[OTC_MIN_TTL_SECONDS, OTC_MAX_TTL_SECONDS]`. `orderHash`, `(makerWallet, nonce)` and `signature` are each unique.
* Acceptances and cancellations: `|signedAt − now| ≤ 300 s`; `(signer, kind, nonce)` is unique.
* The submitting session's wallet must be the signer.

## 7. Counteroffers and negotiation

A counteroffer is a **new order** with:

* `parentOrderHash` = hash of the order being countered;
* `side` opposite to the parent;
* `takerWallet` = the parent's maker;
* the same `tokenMint`, `tokenProgram` and `tokenDecimals`.

Earlier payloads are never modified. Revisions form a thread (`OtcNegotiation`) between the root order's maker and one counterparty. Revision 0 is the root; each counter has `revision = parent.revision + 1`.

* Only the **latest** revision of a thread may be accepted or countered. Concurrent counters to the same revision are serialized by an optimistic lock on the thread head, and exactly one wins.
* A wallet cannot counter its own order.
* In a private thread, a countered revision moves to `NEGOTIATING`. A public root order stays `OPEN` for other takers.
* When a thread settles, its other open revisions become `INVALIDATED`. A non-partial public root whose maker took part in the trade is also invalidated.

## 8. Settlement

### 8.1 Amounts

The price for cumulative fill `x` of an order is `q(x)`:

* `q(total) = quoteAmountRaw`;
* otherwise rounding favours the maker: `ceil(quote·x/total)` for a selling maker, `floor(quote·x/total)` for a buying maker.

The gross price of a fill `f` after `filled` tokens have already traded is `q(filled + f) − q(filled)`, so partial fills always sum exactly to the signed total.

Fill rules: `0 < f ≤ remaining`. Without partial fills, `f = remaining`. With partial fills, `f ≥ minimumFillAmountRaw` unless `f = remaining`.

Fees, in integer lamports:

```
feeBps   = min(order.platformFeeBps, deployment.OTC_PLATFORM_FEE_BPS)   // never above what was signed
totalFee = floor(gross × feeBps / 10000)
SELLER_PAYS: buyerPays = gross;                     sellerReceives = gross − totalFee
BUYER_PAYS:  buyerPays = gross + totalFee;          sellerReceives = gross
SPLIT:       buyerPays = gross + floor(totalFee/2); sellerReceives = gross − (totalFee − floor(totalFee/2))
referralFee  = hasReferrer ? floor(totalFee × OTC_REFERRAL_SHARE_BPS / 10000) : 0
platformFee  = totalFee − referralFee
invariant:   buyerPays = sellerReceives + platformFee + referralFee
```

The referrer is the referrer of the fee-paying side: the buyer for `BUYER_PAYS`, otherwise the seller. A referrer that is a party to the trade, or whose account holds no lamports, receives nothing; its share stays in the platform fee.

### 8.2 Pre-build validation (immediately before building)

* Order is `ACCEPTED` (or `SETTLEMENT_READY` with an expired previous attempt). It expires no sooner than 180 s from now.
* The order and acceptance signatures are re-verified over their stored messages.
* The mint is owned by `tokenProgram` and its decimals equal `tokenDecimals`.
* Token-2022 policy passes (§9).
* The seller's associated token account exists, is owned by the seller, holds the mint, is not frozen, and holds at least `fill`. A seller with 0 lamports must receive at least the rent-exempt minimum.
* The buyer's associated token account, if it exists, is not frozen. The buyer holds at least `buyerPays + network fee + ATA rent (if missing) + rent-exempt minimum`.
* The treasury account exists, or the fee is at least rent-exempt.
* The transaction is simulated, and failures are decoded into specific errors (§10).

### 8.3 Transaction layout

A v0 message with **no address lookup tables**. Fee payer = buyer (signature #0). Signer #1 = seller. Both signers are writable. Instructions, in exactly this order:

| # | Program | Instruction |
| --- | --- | --- |
| 0 | ComputeBudget | `SetComputeUnitLimit(80000)` |
| (1) | ComputeBudget | `SetComputeUnitPrice(µlamports)`, only when > 0 |
| 2 | Associated Token | `CreateIdempotent(payer=buyer, ata=buyerATA, owner=buyer, mint, system, tokenProgram)` |
| 3 | SPL Memo v2 `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | UTF-8 `otc-settlement:v1:<orderHash>:<settlementId>`, no signer accounts |
| 4 | Token / Token-2022 | `TransferChecked(sellerATA → buyerATA, mint, authority=seller, fill, decimals)`, or Token-2022 `TransferCheckedWithFee(…, fee)` when the mint has a non-zero transfer fee |
| 5 | System | `Transfer(buyer → seller, sellerReceives)` when > 0 |
| (6) | System | `Transfer(buyer → treasury, platformFee)` when > 0 |
| (7) | System | `Transfer(buyer → referrer, referralFee)` when > 0 |

ATAs are derived with `allowOwnerOffCurve = false` under the order's `tokenProgram`. The canonical immutable Memo v2 program is used deliberately: Token-2022's `MemoTransfer` extension recognizes it, and `@solana/spl-memo@0.3.x`'s new default (`Memo4c2p…`) is upgradeable.

### 8.4 Verification before signing

A party's client MUST:

1. **strictly decode** the message: v0; no lookup tables; exactly 2 required signatures, both writable; only the six allowlisted programs; at most one each of limit, price, ATA create, memo and token transfer; System transfers only `Transfer` from the fee payer, at most 3; Token only `TransferChecked`/`TransferCheckedWithFee` with no multisig;
2. derive the **expected terms from the maker-signed order**: parties from `side` and the acceptor, mint/program/decimals, the gross price via §8.1, fee ≤ signed, treasury = the deployment's published treasury;
3. require the bytes to equal the canonical message rebuilt from those terms with the same blockhash (byte equality);
4. show the user what they send and receive **as decoded from the message**.

### 8.5 Dual-signature handshake

1. Server builds, self-verifies and simulates the message. It stores `messageBytes`, `sha256(messageBytes)` and the terms. Status `AWAITING_BUYER_SIGNATURE`. A unique per-order lock allows only one live settlement per order.
2. Buyer's wallet signs. The server checks `sha256(tx.message.serialize()) == stored hash` (else `TX_CHANGED`), extracts signature #0, and verifies ed25519 over the stored bytes. It re-checks that the order is still `SETTLEMENT_READY`, unexpired, and the blockhash is usable. Then: `txSignature = buyerSignature`, status `AWAITING_SELLER_SIGNATURE`.
3. Seller signs, with the same checks on signature #1. Status `READY_TO_SUBMIT`.
4. Server assembles `VersionedTransaction(storedMessage, [buyerSig, sellerSig])`, re-verifies both signatures, claims `SUBMITTED`, and broadcasts.
5. Reconciliation accepts the trade only if the landed transaction's message hash equals the stored hash and `meta.err` is null. It then marks the settlement `CONFIRMED` (later `FINALIZED`) and updates the order (`FILLED` / `PARTIALLY_FILLED`).

The server never edits a message between signatures. Any modification (including by a wallet) produces `TX_CHANGED`, and both parties sign again.

### 8.6 Blockhash expiry

A message is valid while the chain's block height is at or below its `lastValidBlockHeight`. Signatures are refused once `blockHeight > lastValidBlockHeight − 10`. A settlement is retired (`EXPIRED`) only when `blockHeight > lastValidBlockHeight` **and** the buyer's signature is not found on chain. Only then can a new attempt be built, with a new blockhash, a new `settlementId`, and a new message. Two live messages for one order therefore never coexist, and old signatures are useless against the new message.

## 9. Token-2022 policy (fail-closed)

| Extension / property | Policy |
| --- | --- |
| MetadataPointer, TokenMetadata, Group/Member pointers, PermissionedBurn | allowed |
| TransferFeeConfig | allowed; settlement uses `TransferCheckedWithFee` with the exact fee for the current epoch; gross, fee and net are shown |
| MintCloseAuthority, mint authority present, Pausable (not paused) | allowed with warning |
| TransferHook (non-default program) | **blocked** |
| PermanentDelegate | **blocked** |
| NonTransferable, ConfidentialTransferMint | **blocked** |
| DefaultAccountState = Frozen, Pausable (paused) | **blocked** |
| InterestBearingConfig, ScaledUiAmountConfig | **blocked** (displayed amounts differ from raw amounts) |
| Freeze authority present | **blocked** unless `OTC_ALLOW_FREEZE_AUTHORITY=true` |
| Any extension not listed | **blocked** |
| Frozen seller/buyer token account | **blocked** |

## 10. Error mapping

Simulation and on-chain failures are decoded per instruction. Token `InsufficientFunds` → `SELLER_INSUFFICIENT_TOKENS`; System lamport shortfall → `BUYER_INSUFFICIENT_SOL`; Token `AccountFrozen` → `SELLER_ACCOUNT_FROZEN`; Token-2022 `FeeMismatch` → `TX_CHANGED`; `BlockhashNotFound` → `BLOCKHASH_EXPIRED`; `InsufficientFundsForRent` → `SELLER_CANNOT_RECEIVE`. The full catalog is in `packages/shared/src/errors.ts`.

## 11. Cancellation semantics and the on-chain alternative

A maker-signed cancellation immediately stops the server from collecting signatures for, submitting, or rebuilding the order's settlement. It cannot revoke a transaction **both** parties already signed: that transaction stays valid until its blockhash expires (≤ ~90 s). Both parties consented to those exact bytes, and if it lands, reconciliation records the fill with a reason. A permissionless on-chain nonce registry (see `programs/otc-settlement/README.md`) would make cancellations binding cryptographically, at the cost of a custom program. Version 1 deliberately does not ship one (see `docs/implementation-plan.md` §2.3).

## 12. Order states

`DRAFT → OPEN → (NEGOTIATING | ACCEPTED) → SETTLEMENT_READY → (FILLED | PARTIALLY_FILLED)`, plus `CANCELLED`, `EXPIRED`, `INVALIDATED`, `FAILED`. Transitions are compare-and-set (`UPDATE … WHERE status IN (allowed)`) and each one is audited. `CANCELLED`, `EXPIRED` and `INVALIDATED` can move to a filled state only with on-chain proof (§11). The table is in `packages/otc/src/state.ts`.

## 13. Test vectors

Run `npx vitest run --project unit packages/otc` for executable vectors: canonical JSON, hash sensitivity to every field, signature acceptance and rejection, cross-domain replay, fee conservation over random inputs, partial-fill sums, and twelve settlement-tampering attacks rejected by the verifier.
