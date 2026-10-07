import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import { createPrismaClient, type Db } from "@app/database";
import { fromBase64, toBase64 } from "@app/solana";
import { verifySettlementMessage, termsFromJson } from "../settlement-tx";
import { acceptOrder, cancelOrder, counterOrder, createOrder, getDeal, getOrder, listOrders } from "../server/orders";
import { prepareSettlement, runMaintenance, submitPartialSignature } from "../server/settlement";
import { verifyReceipt } from "../server/receipt";
import { makeHarness, resetDb, signedAccept, signedCancel, signedCounter, signedOrder, SOL, wallet, walletSign, type Harness } from "../testing/harness";

let db: Db;
let h: Harness;

beforeAll(() => {
  db = createPrismaClient(inject("databaseUrl"));
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  h = makeHarness(db);
});

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

describe("the end-to-end user journey (Bob sells to Carol after a counter)", () => {
  it("negotiates, co-signs one atomic transaction, settles, and verifies from chain", async () => {
    const bob = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const carol = wallet(h, 100n * SOL);

    // 9–11: Bob proposes 20,000,000 TOKEN for 40 SOL, signs, it appears publicly.
    const ask = await createOrder(h.ctx, signedOrder(h, bob, {}));
    expect(ask.status).toBe("OPEN");
    expect((await listOrders(h.ctx, { mint: h.mint.mint.toBase58(), limit: 10 }, null)).items.map((o) => o.id)).toContain(ask.id);

    // 14–15: Carol counters at 37 SOL with a NEW signed order.
    const counter = await counterOrder(h.ctx, ask.id, signedCounter(h, carol, ask, { quoteAmountRaw: 37n * SOL }));
    expect(counter).toMatchObject({ side: "BUY", takerWallet: bob.publicKey.toBase58(), revision: 1, parentOrderId: ask.id, status: "OPEN" });
    expect((await getOrder(h.ctx, ask.id, null)).status).toBe("OPEN"); // the public ask is not mutated

    // 16: Bob accepts 37 SOL.
    const accepted = await acceptOrder(h.ctx, counter.id, signedAccept(h, bob, counter));
    expect(accepted.status).toBe("ACCEPTED");

    // 17–18: balances re-checked, atomic settlement constructed.
    const s = await prepareSettlement(h.ctx, counter.id, bob.publicKey.toBase58());
    expect(s).toMatchObject({ status: "AWAITING_BUYER_SIGNATURE", buyer: carol.publicKey.toBase58(), seller: bob.publicKey.toBase58() });
    expect(s.terms).toMatchObject({ tokenAmountRaw: "20000000000000", sellerReceivesLamports: "36815000000", platformFeeLamports: "185000000" });

    // 19: each wallet verifies the exact terms independently before signing.
    expect(() => verifySettlementMessage(fromBase64(s.messageBase64), termsFromJson(s.terms))).not.toThrow();

    // 20: Carol (buyer, fee payer) then Bob sign the SAME message.
    const afterBuyer = await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, carol), viewer: carol.publicKey.toBase58() });
    expect(afterBuyer.status).toBe("AWAITING_SELLER_SIGNATURE");
    const bobSolBefore = h.chain.balance(bob.publicKey);
    const done = await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, bob), viewer: bob.publicKey.toBase58() });

    // 21–23: transaction confirms, order FILLED.
    expect(done.status).toBe("CONFIRMED");
    expect(h.chain.tokenBalance(h.mint, carol.publicKey)).toBe(20_000_000_000_000n);
    expect(h.chain.balance(bob.publicKey) - bobSolBefore).toBe(36_815_000_000n);
    const filled = await getOrder(h.ctx, counter.id, bob.publicKey.toBase58());
    expect(filled.status).toBe("FILLED");
    expect((await getOrder(h.ctx, ask.id, null)).status).toBe("INVALIDATED"); // superseded public ask

    // 24–25: verifiable receipt built from chain data.
    const receipt = await verifyReceipt(h.ctx, done.txSignature!);
    expect(receipt).toMatchObject({ verified: true, messageHashMatches: true, seller: bob.publicKey.toBase58(), buyer: carol.publicKey.toBase58(), tokenAmountRaw: "20000000000000", sellerReceivedLamports: "36815000000", platformFeeLamports: "185000000", orderHash: counter.orderHash });

    const fee = await db.platformFee.findMany();
    expect(fee).toHaveLength(1);
    const audit = await db.auditEvent.findMany({ where: { entityId: counter.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.toStatus)).toEqual(expect.arrayContaining(["OPEN", "ACCEPTED", "SETTLEMENT_READY", "FILLED"]));
  });
});

describe("invariants", () => {
  async function readyToSign() {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const buyer = wallet(h, 100n * SOL);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, {}));
    await acceptOrder(h.ctx, ask.id, signedAccept(h, buyer, ask));
    const s = await prepareSettlement(h.ctx, ask.id, buyer.publicKey.toBase58());
    return { seller, buyer, ask, s };
  }

  it("an already-filled order cannot settle twice", async () => {
    const { seller, buyer, ask, s } = await readyToSign();
    await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, buyer), viewer: buyer.publicKey.toBase58() });
    await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() });
    const other = wallet(h);
    expect(await code(acceptOrder(h.ctx, ask.id, signedAccept(h, other, { ...ask, remainingAmountRaw: ask.tokenAmountRaw })))).toBe("ORDER_FILLED");
    expect(await code(prepareSettlement(h.ctx, ask.id, buyer.publicKey.toBase58()))).toBe("SETTLEMENT_NOT_READY");
    expect(await code(submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() }))).toBe("SETTLEMENT_NOT_READY");
  });

  it("a cancelled order cannot settle, even mid-signing", async () => {
    const { seller, buyer, ask, s } = await readyToSign();
    await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, buyer), viewer: buyer.publicKey.toBase58() });
    await cancelOrder(h.ctx, ask.id, signedCancel(h, seller, ask));
    expect(await code(submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() }))).toBe("SETTLEMENT_NOT_READY");
    expect(h.chain.tokenBalance(h.mint, buyer.publicKey)).toBe(0n);
    expect((await getOrder(h.ctx, ask.id, null)).status).toBe("CANCELLED");
  });

  it("only the maker can cancel, with a fresh maker signature", async () => {
    const { buyer, ask, seller } = await readyToSign();
    expect(await code(cancelOrder(h.ctx, ask.id, signedCancel(h, buyer, ask)))).toBe("FORBIDDEN");
    expect(await code(cancelOrder(h.ctx, ask.id, { ...signedCancel(h, seller, ask, -3600) }))).toBe("VALIDATION");
    const forged = signedCancel(h, buyer, ask);
    expect(await code(cancelOrder(h.ctx, ask.id, { ...forged, viewer: seller.publicKey.toBase58() }))).toBe("VALIDATION");
  });

  it("an expired order cannot be accepted or settled", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const buyer = wallet(h);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, { ttlSeconds: 600 }));
    h.clock.offsetMs = 601_000;
    expect(await code(acceptOrder(h.ctx, ask.id, signedAccept(h, buyer, ask)))).toBe("ORDER_EXPIRED");
    await runMaintenance(h.ctx);
    expect((await getOrder(h.ctx, ask.id, null)).status).toBe("EXPIRED");
  });

  it("blockhash expiry forces BOTH parties to sign a rebuilt transaction; old signatures are useless", async () => {
    const { seller, buyer, ask, s } = await readyToSign();
    await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, buyer), viewer: buyer.publicKey.toBase58() });
    h.chain.advanceBlocks(200);
    expect(await code(submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() }))).toBe("BLOCKHASH_EXPIRED");
    expect((await getOrder(h.ctx, ask.id, null)).status).toBe("ACCEPTED");

    const s2 = await prepareSettlement(h.ctx, ask.id, seller.publicKey.toBase58());
    expect(s2.id).not.toBe(s.id);
    expect(s2.attempt).toBe(2);
    expect(s2.messageHash).not.toBe(s.messageHash);
    // Re-submitting the buyer's OLD signed transaction against the new settlement is rejected.
    expect(await code(submitPartialSignature(h.ctx, s2.id, { signedTransactionBase64: walletSign(s, buyer), viewer: buyer.publicKey.toBase58() }))).toBe("TX_CHANGED");
    await submitPartialSignature(h.ctx, s2.id, { signedTransactionBase64: walletSign(s2, buyer), viewer: buyer.publicKey.toBase58() });
    const done = await submitPartialSignature(h.ctx, s2.id, { signedTransactionBase64: walletSign(s2, seller), viewer: seller.publicKey.toBase58() });
    expect(done.status).toBe("CONFIRMED");
  });

  it("a wallet-modified transaction is rejected (the backend never accepts a different message)", async () => {
    const { buyer, s } = await readyToSign();
    const msg = VersionedMessage.deserialize(fromBase64(s.messageBase64));
    msg.recentBlockhash = "11111111111111111111111111111111";
    const tx = new VersionedTransaction(msg);
    tx.sign([buyer]);
    expect(await code(submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: toBase64(tx.serialize()), viewer: buyer.publicKey.toBase58() }))).toBe("TX_CHANGED");
  });

  it("signature from the wrong wallet is rejected and signing order is enforced", async () => {
    const { seller, buyer, s } = await readyToSign();
    expect(await code(submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() }))).toBe("SETTLEMENT_NOT_READY");
    expect(await code(submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: buyer.publicKey.toBase58() }))).toBe("SIGNATURE_INVALID");
    const stranger = wallet(h);
    expect(await code(submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, buyer), viewer: stranger.publicKey.toBase58() }))).toBe("FORBIDDEN");
  });

  it("seller who no longer holds the tokens is caught before signing", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const buyer = wallet(h);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, {}));
    await acceptOrder(h.ctx, ask.id, signedAccept(h, buyer, ask));
    // Seller moves tokens away after posting.
    const { createTransferCheckedInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = await import("@solana/spl-token");
    const sink = wallet(h).publicKey;
    const from = getAssociatedTokenAddressSync(h.mint.mint, seller.publicKey, false, h.mint.programId);
    const to = getAssociatedTokenAddressSync(h.mint.mint, sink, false, h.mint.programId);
    h.chain.exec([createAssociatedTokenAccountIdempotentInstruction(h.chain.payer.publicKey, to, sink, h.mint.mint, h.mint.programId), createTransferCheckedInstruction(from, h.mint.mint, to, seller.publicKey, 10n, 6, [], h.mint.programId)], [seller]);
    expect(await code(prepareSettlement(h.ctx, ask.id, buyer.publicKey.toBase58()))).toBe("SELLER_INSUFFICIENT_TOKENS");
  });

  it("buyer without enough SOL is caught at acceptance, and fees/rent are checked again before signing", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, {}));
    const poor = wallet(h, 5n * SOL);
    expect(await code(acceptOrder(h.ctx, ask.id, signedAccept(h, poor, ask)))).toBe("BUYER_INSUFFICIENT_SOL");
    const exact = wallet(h, 40n * SOL + 1_000n); // covers the price, not the network fee + new token account rent
    await acceptOrder(h.ctx, ask.id, signedAccept(h, exact, ask));
    expect(await code(prepareSettlement(h.ctx, ask.id, exact.publicKey.toBase58()))).toBe("BUYER_INSUFFICIENT_SOL");
  });

  it("one wallet cannot hold more than three orders at once (acceptance griefing)", async () => {
    const taker = wallet(h, 1_000n * SOL);
    const asks = [];
    for (let i = 0; i < 4; i++) asks.push(await createOrder(h.ctx, signedOrder(h, wallet(h, 1n * SOL, 20_000_000_000_000n), {})));
    for (const a of asks.slice(0, 3)) await acceptOrder(h.ctx, a.id, signedAccept(h, taker, a));
    expect(await code(acceptOrder(h.ctx, asks[3]!.id, signedAccept(h, taker, asks[3]!)))).toBe("RATE_LIMITED");
  });

  it("concurrent acceptances: exactly one wins", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, {}));
    const takers = [wallet(h), wallet(h), wallet(h), wallet(h)];
    const results = await Promise.all(takers.map((t) => code(acceptOrder(h.ctx, ask.id, signedAccept(h, t, ask)))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
  });

  it("concurrent settlement preparation creates one live settlement", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const buyer = wallet(h);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, {}));
    await acceptOrder(h.ctx, ask.id, signedAccept(h, buyer, ask));
    const results = await Promise.allSettled([1, 2, 3].map(() => prepareSettlement(h.ctx, ask.id, buyer.publicKey.toBase58())));
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(new Set(ok).size).toBeLessThanOrEqual(1);
    expect(await db.otcSettlement.count({ where: { activeLock: { not: null } } })).toBe(1);
  });

  it("replays are rejected: duplicate order, reused nonce, and forged maker", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const o = signedOrder(h, seller, {});
    await createOrder(h.ctx, o);
    expect(await code(createOrder(h.ctx, o))).toBe("ORDER_DUPLICATE");
    const impostor = wallet(h);
    expect(await code(createOrder(h.ctx, { ...o, viewer: impostor.publicKey.toBase58() }))).toBe("FORBIDDEN");
    const otherSig = signedOrder(h, impostor, {});
    expect(await code(createOrder(h.ctx, { ...otherSig, signature: o.signature }))).toBe("SIGNATURE_INVALID");
  });

  it("orders signed with the wrong fee terms are refused", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    expect(await code(createOrder(h.ctx, signedOrder(h, seller, { platformFeeBps: 0 })))).toBe("FEE_MISMATCH");
  });

  it("private offers: only the designated wallet can see or accept; the URL grants nothing", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const designated = wallet(h);
    const stranger = wallet(h);
    const offer = await createOrder(h.ctx, signedOrder(h, seller, { takerWallet: designated.publicKey.toBase58() }));
    expect(await code(getOrder(h.ctx, offer.id, stranger.publicKey.toBase58()))).toBe("NOT_FOUND");
    expect(await getDeal(h.ctx, offer.publicId, stranger.publicKey.toBase58())).toEqual({ restricted: true, isPrivate: true });
    expect(await getDeal(h.ctx, offer.publicId, null)).toEqual({ restricted: true, isPrivate: true });
    expect(await code(acceptOrder(h.ctx, offer.id, signedAccept(h, stranger, offer)))).toBe("NOT_FOUND");
    expect((await listOrders(h.ctx, { limit: 50 }, null)).items.find((o) => o.id === offer.id)).toBeUndefined();
    expect((await acceptOrder(h.ctx, offer.id, signedAccept(h, designated, offer))).status).toBe("ACCEPTED");
    const notes = await db.notification.findMany({ where: { wallet: designated.publicKey.toBase58() } });
    expect(notes.map((n) => n.type)).toContain("OFFER_RECEIVED");
  });

  it("only the latest revision of a negotiation can be accepted or countered", async () => {
    const bob = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const carol = wallet(h);
    const offer = await createOrder(h.ctx, signedOrder(h, bob, { takerWallet: carol.publicKey.toBase58() }));
    const c1 = await counterOrder(h.ctx, offer.id, signedCounter(h, carol, offer, { quoteAmountRaw: 37n * SOL }));
    expect((await getOrder(h.ctx, offer.id, bob.publicKey.toBase58())).status).toBe("NEGOTIATING");
    expect(await code(acceptOrder(h.ctx, offer.id, signedAccept(h, carol, offer)))).toBe("ORDER_NOT_LATEST_REVISION");
    const c2 = await counterOrder(h.ctx, c1.id, signedCounter(h, bob, c1, { quoteAmountRaw: 38_500_000_000n }));
    expect(c2.revision).toBe(2);
    expect(await code(counterOrder(h.ctx, c1.id, signedCounter(h, bob, c1, { quoteAmountRaw: 39n * SOL })))).toBe("ORDER_NOT_LATEST_REVISION");
    const deal = await getDeal(h.ctx, c2.publicId, carol.publicKey.toBase58());
    expect(deal.restricted).toBe(false);
    if (!deal.restricted) expect(deal.negotiation?.revisions.map((r) => r.revision)).toEqual([0, 1, 2]);
  });

  it("partial fills settle in pieces and sum exactly to the signed totals", async () => {
    const seller = wallet(h, 1n * SOL, 3_000_000n);
    const b1 = wallet(h);
    const b2 = wallet(h);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, { tokenAmountRaw: 3_000_000n, quoteAmountRaw: 10n * SOL, allowPartialFill: true, minimumFillAmountRaw: 1_000_000n }));
    const settle = async (buyer: typeof b1, fill: bigint) => {
      const o = await getOrder(h.ctx, ask.id, null);
      await acceptOrder(h.ctx, ask.id, signedAccept(h, buyer, o, fill));
      const s = await prepareSettlement(h.ctx, ask.id, buyer.publicKey.toBase58());
      await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, buyer), viewer: buyer.publicKey.toBase58() });
      return submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() });
    };
    const first = await settle(b1, 1_000_000n);
    expect((await getOrder(h.ctx, ask.id, null)).status).toBe("PARTIALLY_FILLED");
    const second = await settle(b2, 2_000_000n);
    expect((await getOrder(h.ctx, ask.id, null)).status).toBe("FILLED");
    expect(BigInt(first.grossQuoteLamports) + BigInt(second.grossQuoteLamports)).toBe(10n * SOL);
  });

  it("referrer of the fee-paying side receives its disclosed share of the platform fee in the same transaction", async () => {
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const buyer = wallet(h);
    const referrer = wallet(h, 1n * SOL);
    await db.referralAttribution.create({ data: { wallet: seller.publicKey.toBase58(), referrerWallet: referrer.publicKey.toBase58(), code: "TEST" } });
    const ask = await createOrder(h.ctx, signedOrder(h, seller, {}));
    await acceptOrder(h.ctx, ask.id, signedAccept(h, buyer, ask));
    const s = await prepareSettlement(h.ctx, ask.id, buyer.publicKey.toBase58());
    expect(s.terms).toMatchObject({ platformFeeLamports: "160000000", referralFeeLamports: "40000000", referrerWallet: referrer.publicKey.toBase58() });
    const before = h.chain.balance(referrer.publicKey);
    await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, buyer), viewer: buyer.publicKey.toBase58() });
    await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() });
    expect(h.chain.balance(referrer.publicKey) - before).toBe(40_000_000n);
    expect(await db.referralPayout.count()).toBe(1);
  });
});

describe("Token-2022 transfer-fee tokens", () => {
  it("shows gross / fee / net and the buyer receives exactly the net amount", async () => {
    h = makeHarness(db, { transferFeeBps: 100 });
    const seller = wallet(h, 1n * SOL, 20_000_000_000_000n);
    const buyer = wallet(h);
    const ask = await createOrder(h.ctx, signedOrder(h, seller, {}));
    await acceptOrder(h.ctx, ask.id, signedAccept(h, buyer, ask));
    const s = await prepareSettlement(h.ctx, ask.id, buyer.publicKey.toBase58());
    expect(s.terms.transferFeeRaw).toBe("200000000000");
    expect(s.netTokenReceivedRaw).toBe("19800000000000");
    await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, buyer), viewer: buyer.publicKey.toBase58() });
    const done = await submitPartialSignature(h.ctx, s.id, { signedTransactionBase64: walletSign(s, seller), viewer: seller.publicKey.toBase58() });
    expect(h.chain.tokenBalance(h.mint, buyer.publicKey)).toBe(19_800_000_000_000n);
    const receipt = await verifyReceipt(h.ctx, done.txSignature!);
    expect(receipt.netTokenReceivedRaw).toBe("19800000000000");
  });
});
