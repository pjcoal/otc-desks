import { describe, expect, it } from "vitest";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { canonicalJson, hashPayload } from "../canonical";
import { newAcceptPayload, newCancelPayload, newOrderPayload } from "../build";
import { buildAcceptMessage, buildCancelMessage, buildOrderMessage } from "../messages";
import { isFresh, verifyAccept, verifyCancel, verifyOrder } from "../verify";
import { DOMAIN, signText } from "./helpers";

const maker = Keypair.generate();
const mint = Keypair.generate().publicKey.toBase58();

function order(over: Partial<Parameters<typeof newOrderPayload>[1]> = {}) {
  return newOrderPayload(DOMAIN, {
    makerWallet: maker.publicKey.toBase58(),
    takerWallet: null,
    tokenMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    tokenDecimals: 6,
    side: "SELL",
    tokenAmountRaw: 20_000_000_000_000n,
    quoteAmountRaw: 40_000_000_000n,
    ttlSeconds: 3600,
    allowPartialFill: false,
    platformFeeBps: 50,
    feeMode: "SELLER_PAYS",
    ...over,
  });
}

describe("canonical serialization", () => {
  it("is key-order independent and whitespace-free", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("rejects floats, unsafe integers and undefined", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
    expect(() => canonicalJson({ a: 2 ** 60 })).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: new Date() })).toThrow();
  });
  it("order hash is deterministic and changes with every field", () => {
    const o = order();
    expect(hashPayload(o)).toBe(hashPayload({ ...o }));
    expect(hashPayload(o)).toMatch(/^[0-9a-f]{64}$/);
    for (const [k, v] of Object.entries({ quoteAmountRaw: "39999999999", tokenAmountRaw: "1", tokenMint: Keypair.generate().publicKey.toBase58(), takerWallet: Keypair.generate().publicKey.toBase58(), platformFeeBps: 49, network: "mainnet-beta", expiresAt: o.expiresAt + 1 })) {
      expect(hashPayload({ ...o, [k]: v } as typeof o)).not.toBe(hashPayload(o));
    }
  });
});

describe("order signatures", () => {
  it("verifies a correctly signed order", () => {
    const o = order();
    const sig = signText(maker, buildOrderMessage(o));
    const r = verifyOrder(o, sig, DOMAIN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.orderHash).toBe(hashPayload(o));
  });

  it("rejects any tampered economic field (price, quantity, mint, counterparty)", () => {
    const o = order();
    const sig = signText(maker, buildOrderMessage(o));
    const tampered = [
      { ...o, quoteAmountRaw: "1" },
      { ...o, tokenAmountRaw: "30000000000000", minimumFillAmountRaw: "30000000000000" },
      { ...o, tokenMint: Keypair.generate().publicKey.toBase58() },
      { ...o, takerWallet: Keypair.generate().publicKey.toBase58() },
      { ...o, platformFeeBps: 0 },
      { ...o, side: "BUY" as const },
    ];
    for (const t of tampered) expect(verifyOrder(t, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SIGNATURE" });
  });

  it("rejects a forged maker (signature by a different key)", () => {
    const o = order();
    const sig = signText(Keypair.generate(), buildOrderMessage(o));
    expect(verifyOrder(o, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SIGNATURE" });
  });

  it("rejects cross-network and cross-domain replay", () => {
    const o = order();
    const sig = signText(maker, buildOrderMessage(o));
    expect(verifyOrder(o, sig, { ...DOMAIN, network: "mainnet-beta", genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" })).toMatchObject({ ok: false, reason: "DOMAIN" });
    expect(verifyOrder(o, sig, { ...DOMAIN, environment: "evil.example" })).toMatchObject({ ok: false, reason: "DOMAIN" });
  });

  it("rejects malformed payloads before touching signatures", () => {
    const o = order();
    const sig = signText(maker, buildOrderMessage(o));
    expect(verifyOrder({ ...o, extra: 1 }, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SCHEMA" });
    expect(verifyOrder({ ...o, quoteAmountRaw: "1e9" }, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SCHEMA" });
    expect(verifyOrder({ ...o, quoteAmountRaw: "00100" }, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SCHEMA" });
    expect(verifyOrder({ ...o, note: "line1\nOrder hash: fake" }, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SCHEMA" });
    expect(verifyOrder({ ...o, expiresAt: o.createdAt }, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SCHEMA" });
    expect(verifyOrder({ ...o, takerWallet: o.makerWallet }, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SCHEMA" });
    expect(verifyOrder({ ...o, tokenAmountRaw: "18446744073709551616" }, sig, DOMAIN)).toMatchObject({ ok: false, reason: "SCHEMA" });
  });

  it("enforces partial-fill minimum consistency", () => {
    expect(verifyOrder({ ...order(), allowPartialFill: false, minimumFillAmountRaw: "1" }, "x", DOMAIN)).toMatchObject({ reason: "SCHEMA" });
    expect(verifyOrder({ ...order(), allowPartialFill: true, minimumFillAmountRaw: "0" }, "x", DOMAIN)).toMatchObject({ reason: "SCHEMA" });
  });

  it("message embeds the full mint, raw amounts, domain and hash", () => {
    const o = order();
    const m = buildOrderMessage(o);
    expect(m).toContain(o.tokenMint);
    expect(m).toContain("raw 20000000000000");
    expect(m).toContain("40,000,000,000 lamports".replace("40,000,000,000", "40000000000"));
    expect(m).toContain(`Order hash: ${hashPayload(o)}`);
    expect(m).toContain("devnet");
  });
});

describe("accept & cancel signatures", () => {
  it("accept binds order hash, acceptor and fill", () => {
    const o = order();
    const taker = Keypair.generate();
    const a = newAcceptPayload(DOMAIN, hashPayload(o), taker.publicKey.toBase58(), BigInt(o.tokenAmountRaw), BigInt(o.quoteAmountRaw));
    const sig = signText(taker, buildAcceptMessage(a, o));
    expect(verifyAccept(a, sig, DOMAIN, o).ok).toBe(true);
    expect(verifyAccept({ ...a, fillAmountRaw: "1" }, sig, DOMAIN, o).ok).toBe(false);
    expect(verifyAccept({ ...a, acceptor: maker.publicKey.toBase58() }, sig, DOMAIN, o).ok).toBe(false);
  });

  it("cancel must be signed by the maker", () => {
    const o = order();
    const c = newCancelPayload(DOMAIN, hashPayload(o), maker.publicKey.toBase58());
    expect(verifyCancel(c, signText(maker, buildCancelMessage(c)), DOMAIN).ok).toBe(true);
    expect(verifyCancel(c, signText(Keypair.generate(), buildCancelMessage(c)), DOMAIN).ok).toBe(false);
  });

  it("action signatures expire after the skew window", () => {
    const now = 2_000_000_000;
    expect(isFresh(now - 299, now)).toBe(true);
    expect(isFresh(now - 301, now)).toBe(false);
    expect(isFresh(now + 301, now)).toBe(false);
  });

  it("order, accept and cancel messages are not interchangeable", () => {
    const o = order();
    const c = newCancelPayload(DOMAIN, hashPayload(o), maker.publicKey.toBase58());
    const orderSig = signText(maker, buildOrderMessage(o));
    expect(verifyCancel(c, orderSig, DOMAIN).ok).toBe(false);
  });
});
