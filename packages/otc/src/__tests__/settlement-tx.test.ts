import { describe, expect, it } from "vitest";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, MessageV0, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { buildSettlementInstructions, compileSettlementMessage, decodeSettlementMessage, SettlementVerificationError, verifySettlementMessage, type SettlementTerms } from "../settlement-tx";
import { compileV0 } from "@app/solana";

const seller = Keypair.generate().publicKey.toBase58();
const buyer = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const blockhash = Keypair.generate().publicKey.toBase58();

function terms(over: Partial<SettlementTerms> = {}): SettlementTerms {
  return {
    settlementId: "stl_1",
    orderHash: "a".repeat(64),
    seller,
    buyer,
    tokenMint: Keypair.generate().publicKey.toBase58(),
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    tokenDecimals: 6,
    tokenAmountRaw: 20_000_000_000_000n,
    transferFeeRaw: null,
    sellerReceivesLamports: 36_815_000_000n,
    platformFeeLamports: 185_000_000n,
    treasuryWallet: treasury,
    referralFeeLamports: 0n,
    referrerWallet: null,
    computeUnitLimit: 80_000,
    computeUnitPriceMicroLamports: 0,
    ...over,
  };
}

function rebuild(t: SettlementTerms, mutate: (ixs: TransactionInstruction[]) => TransactionInstruction[], payer = t.buyer) {
  return compileV0(new PublicKey(payer), mutate(buildSettlementInstructions(t)), blockhash, 0).bytes;
}

describe("settlement transaction", () => {
  it("builds a 2-signer v0 message whose decode matches the terms", () => {
    const t = terms();
    const built = compileSettlementMessage(t, blockhash, 100);
    const d = verifySettlementMessage(built.bytes, t);
    expect(d.feePayer).toBe(buyer);
    expect(d.signers).toEqual([buyer, seller]);
    expect(d.tokenTransfer.amount).toBe(t.tokenAmountRaw);
    expect(d.solTransfers).toEqual([
      { from: buyer, to: seller, lamports: 36_815_000_000n },
      { from: buyer, to: treasury, lamports: 185_000_000n },
    ]);
    expect(d.memo).toBe(`otc-settlement:v1:${"a".repeat(64)}:stl_1`);
    expect(MessageV0.deserialize(built.bytes).header.numRequiredSignatures).toBe(2);
  });

  it("is deterministic for identical terms and blockhash", () => {
    const t = terms();
    expect(compileSettlementMessage(t, blockhash, 1).hash).toBe(compileSettlementMessage(t, blockhash, 1).hash);
  });

  it("supports classic SPL tokens and Token-2022 transfer fees", () => {
    const classic = terms({ tokenProgram: TOKEN_PROGRAM_ID.toBase58() });
    expect(() => verifySettlementMessage(compileSettlementMessage(classic, blockhash, 1).bytes, classic)).not.toThrow();
    const withFee = terms({ transferFeeRaw: 12_345n });
    const d = verifySettlementMessage(compileSettlementMessage(withFee, blockhash, 1).bytes, withFee);
    expect(d.tokenTransfer.fee).toBe(12_345n);
  });

  const attacks: Array<[string, (t: SettlementTerms) => Uint8Array]> = [
    ["extra drain instruction", (t) => rebuild(t, (ixs) => [...ixs, SystemProgram.transfer({ fromPubkey: new PublicKey(buyer), toPubkey: Keypair.generate().publicKey, lamports: 1n })])],
    ["token amount substitution", (t) => compileSettlementMessage({ ...t, tokenAmountRaw: t.tokenAmountRaw - 1n }, blockhash, 1).bytes],
    ["seller payment reduced", (t) => compileSettlementMessage({ ...t, sellerReceivesLamports: 1n }, blockhash, 1).bytes],
    ["fee raised", (t) => compileSettlementMessage({ ...t, platformFeeLamports: t.platformFeeLamports + 1n }, blockhash, 1).bytes],
    ["mint substitution", (t) => compileSettlementMessage({ ...t, tokenMint: Keypair.generate().publicKey.toBase58() }, blockhash, 1).bytes],
    ["treasury substitution", (t) => compileSettlementMessage({ ...t, treasuryWallet: Keypair.generate().publicKey.toBase58() }, blockhash, 1).bytes],
    ["counterparty substitution", (t) => compileSettlementMessage({ ...t, buyer: Keypair.generate().publicKey.toBase58() }, blockhash, 1).bytes],
    ["memo for another order", (t) => compileSettlementMessage({ ...t, orderHash: "b".repeat(64) }, blockhash, 1).bytes],
    ["unknown program", (t) => rebuild(t, (ixs) => [...ixs, new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })])],
    ["seller pays fees", (t) => rebuild(t, (ixs) => ixs, t.seller)],
    ["duplicate compute budget", (t) => rebuild(t, (ixs) => [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs])],
    ["transfer fee removed", (t) => compileSettlementMessage({ ...t, transferFeeRaw: 5n }, blockhash, 1).bytes],
  ];

  for (const [name, attack] of attacks) {
    it(`rejects: ${name}`, () => {
      const t = terms();
      expect(() => verifySettlementMessage(attack(t), t)).toThrow(SettlementVerificationError);
    });
  }

  it("strict decode rejects non-allowlisted programs even without terms", () => {
    const t = terms();
    const bytes = rebuild(t, (ixs) => [...ixs, new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })]);
    expect(() => decodeSettlementMessage(bytes)).toThrow(/non-allowlisted/);
  });

  it("refuses to build nonsensical terms", () => {
    expect(() => buildSettlementInstructions(terms({ seller: buyer }))).toThrow();
    expect(() => buildSettlementInstructions(terms({ tokenProgram: TOKEN_PROGRAM_ID.toBase58(), transferFeeRaw: 1n }))).toThrow();
    expect(() => buildSettlementInstructions(terms({ treasuryWallet: null }))).toThrow();
  });
});
