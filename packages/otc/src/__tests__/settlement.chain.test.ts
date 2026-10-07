import { describe, expect, it } from "vitest";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { calculateFee } from "@solana/spl-token";
import { compileSettlementMessage, type SettlementTerms } from "../settlement-tx";
import { LiteSvmGateway, LiteSvmError } from "../testing/litesvm-gateway";

const SOL = 1_000_000_000n;

function setup(opts: { token2022?: boolean; transferFeeBps?: number; sellerTokens?: bigint; buyerLamports?: bigint } = {}) {
  const chain = new LiteSvmGateway();
  const seller = Keypair.generate();
  const buyer = Keypair.generate();
  const treasury = Keypair.generate();
  chain.airdrop(seller.publicKey, SOL);
  chain.airdrop(buyer.publicKey, opts.buyerLamports ?? 50n * SOL);
  chain.airdrop(treasury.publicKey, SOL);
  const m = chain.createMint({ token2022: opts.token2022 ?? true, ...(opts.transferFeeBps ? { transferFeeBps: opts.transferFeeBps } : {}) });
  chain.mintTo(m, seller.publicKey, opts.sellerTokens ?? 20_000_000_000_000n);
  return { chain, seller, buyer, treasury, m };
}

function terms(s: ReturnType<typeof setup>, over: Partial<SettlementTerms> = {}): SettlementTerms {
  return {
    settlementId: "stl_test_1",
    orderHash: "c".repeat(64),
    seller: s.seller.publicKey.toBase58(),
    buyer: s.buyer.publicKey.toBase58(),
    tokenMint: s.m.mint.toBase58(),
    tokenProgram: s.m.programId.toBase58(),
    tokenDecimals: 6,
    tokenAmountRaw: 20_000_000_000_000n,
    transferFeeRaw: null,
    sellerReceivesLamports: 36_815_000_000n,
    platformFeeLamports: 185_000_000n,
    treasuryWallet: s.treasury.publicKey.toBase58(),
    referralFeeLamports: 0n,
    referrerWallet: null,
    computeUnitLimit: 80_000,
    computeUnitPriceMicroLamports: 0,
    ...over,
  };
}

async function signedTx(s: ReturnType<typeof setup>, t: SettlementTerms, signers: Keypair[] = [s.buyer, s.seller]) {
  const { blockhash, lastValidBlockHeight } = await s.chain.getLatestBlockhash();
  const built = compileSettlementMessage(t, blockhash, lastValidBlockHeight);
  const tx = new VersionedTransaction(built.message);
  tx.sign(signers);
  return { tx, built };
}

describe("atomic OTC settlement on a real SVM", () => {
  it("moves tokens to the buyer and SOL to the seller + treasury in one transaction", async () => {
    const s = setup();
    const t = terms(s);
    const before = { seller: s.chain.balance(s.seller.publicKey), treasury: s.chain.balance(s.treasury.publicKey), buyer: s.chain.balance(s.buyer.publicKey) };
    const { tx } = await signedTx(s, t);
    await s.chain.send(tx.serialize());
    expect(s.chain.tokenBalance(s.m, s.buyer.publicKey)).toBe(20_000_000_000_000n);
    expect(s.chain.tokenBalance(s.m, s.seller.publicKey)).toBe(0n);
    expect(s.chain.balance(s.seller.publicKey) - before.seller).toBe(36_815_000_000n);
    expect(s.chain.balance(s.treasury.publicKey) - before.treasury).toBe(185_000_000n);
    // buyer pays: seller + fee + network fee + ATA rent
    expect(before.buyer - s.chain.balance(s.buyer.publicKey)).toBeGreaterThan(37_000_000_000n);
  });

  it("works with classic SPL tokens too", async () => {
    const s = setup({ token2022: false });
    const { tx } = await signedTx(s, terms(s));
    await s.chain.send(tx.serialize());
    expect(s.chain.tokenBalance(s.m, s.buyer.publicKey)).toBe(20_000_000_000_000n);
  });

  it("insufficient seller tokens → neither leg settles", async () => {
    const s = setup({ sellerTokens: 1_000n });
    const before = s.chain.balance(s.seller.publicKey);
    const { tx } = await signedTx(s, terms(s));
    await expect(s.chain.send(tx.serialize())).rejects.toMatchObject({ transactionError: { InstructionError: [3, { Custom: 1 }] } });
    expect(s.chain.balance(s.seller.publicKey)).toBe(before);
    expect(s.chain.tokenBalance(s.m, s.seller.publicKey)).toBe(1_000n);
  });

  it("insufficient buyer SOL → neither leg settles", async () => {
    const s = setup({ buyerLamports: 2n * SOL });
    const { tx } = await signedTx(s, terms(s));
    await expect(s.chain.send(tx.serialize())).rejects.toBeInstanceOf(LiteSvmError);
    expect(s.chain.tokenBalance(s.m, s.seller.publicKey)).toBe(20_000_000_000_000n);
  });

  it("expired blockhash is rejected", async () => {
    const s = setup();
    const { tx } = await signedTx(s, terms(s));
    s.chain.advanceBlocks(200);
    await expect(s.chain.send(tx.serialize())).rejects.toMatchObject({ transactionError: "BlockhashNotFound" });
  });

  it("missing or wrong seller signature is rejected", async () => {
    const s = setup();
    const t = terms(s);
    const { blockhash, lastValidBlockHeight } = await s.chain.getLatestBlockhash();
    const built = compileSettlementMessage(t, blockhash, lastValidBlockHeight);
    const onlyBuyer = new VersionedTransaction(built.message);
    onlyBuyer.sign([s.buyer]);
    await expect(s.chain.send(onlyBuyer.serialize())).rejects.toBeInstanceOf(LiteSvmError);
    const wrong = new VersionedTransaction(built.message);
    wrong.sign([s.buyer]);
    wrong.signatures[1] = Keypair.generate().secretKey.slice(0, 64); // garbage signature
    await expect(s.chain.send(wrong.serialize())).rejects.toBeInstanceOf(LiteSvmError);
    expect(s.chain.tokenBalance(s.m, s.seller.publicKey)).toBe(20_000_000_000_000n);
  });

  it("the same signed transaction cannot settle twice", async () => {
    const s = setup({ sellerTokens: 40_000_000_000_000n });
    const { tx } = await signedTx(s, terms(s));
    await s.chain.send(tx.serialize());
    await expect(s.chain.send(tx.serialize())).rejects.toBeInstanceOf(LiteSvmError);
    expect(s.chain.tokenBalance(s.m, s.buyer.publicKey)).toBe(20_000_000_000_000n);
  });

  it("Token-2022 transfer fee: buyer receives exactly gross − fee and the fee is asserted", async () => {
    const s = setup({ transferFeeBps: 100 });
    const amount = 20_000_000_000_000n;
    const fee = calculateFee({ epoch: 0n, maximumFee: 1_000_000_000_000n, transferFeeBasisPoints: 100 }, amount);
    const { tx } = await signedTx(s, terms(s, { transferFeeRaw: fee }));
    await s.chain.send(tx.serialize());
    expect(s.chain.tokenBalance(s.m, s.buyer.publicKey)).toBe(amount - fee);

    const s2 = setup({ transferFeeBps: 100 });
    const { tx: wrongFee } = await signedTx(s2, terms(s2, { transferFeeRaw: fee - 1n }));
    await expect(s2.chain.send(wrongFee.serialize())).rejects.toBeInstanceOf(LiteSvmError);
  });

  it("simulation surfaces the failing leg before anyone signs", async () => {
    const s = setup({ sellerTokens: 5n });
    const { blockhash, lastValidBlockHeight } = await s.chain.getLatestBlockhash();
    const built = compileSettlementMessage(terms(s), blockhash, lastValidBlockHeight);
    const sim = await s.chain.simulate(new VersionedTransaction(built.message));
    expect(sim.err).toEqual({ InstructionError: [3, { Custom: 1 }] });
  });
});
