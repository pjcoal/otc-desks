import { describe, expect, it } from "vitest";
import { createTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, MessageV0, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PUMP_PROGRAM_ID } from "./constants";
import { encodeBuyExactQuoteInV2 } from "./ix-data";
import { verifyTradeMessage } from "./trade-verify";

const user = Keypair.generate().publicKey;
const buyIx = (lamports: bigint, min: bigint) => new TransactionInstruction({ programId: PUMP_PROGRAM_ID, keys: [{ pubkey: user, isSigner: true, isWritable: true }], data: Buffer.from(encodeBuyExactQuoteInV2(lamports, min)) });
const compile = (ixs: TransactionInstruction[], payer = user) => MessageV0.compile({ payerKey: payer, instructions: ixs, recentBlockhash: PublicKey.unique().toBase58() }).serialize();
const exp = { user: user.toBase58(), side: "BUY" as const, venue: "PUMP_BONDING_CURVE" as const, inputAmount: 1_000n, minOutput: 900n, maxInput: 1_000n, expectedOutput: 950n };

describe("client-side trade verification", () => {
  it("accepts the exact quoted buy", () => {
    expect(verifyTradeMessage(compile([ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), buyIx(1_000n, 900n)]), exp)).toEqual([]);
  });
  it("rejects a weakened minimum-out (slippage silently changed)", () => {
    expect(verifyTradeMessage(compile([buyIx(1_000n, 1n)]), exp)).toContain("buy amounts differ from your quote");
  });
  it("rejects an extra drain of SOL to someone else", () => {
    const drain = SystemProgram.transfer({ fromPubkey: user, toPubkey: Keypair.generate().publicKey, lamports: 1n });
    expect(verifyTradeMessage(compile([buyIx(1_000n, 900n), drain]), exp).join()).toMatch(/only move into your own wrapped-SOL account/);
    expect(verifyTradeMessage(compile([buyIx(1_000n, 900n), buyIx(1_000n, 900n)]), exp)).toContain("expected 1 trade instruction(s), found 2");
  });
  it("rejects token transfers smuggled into a trade", () => {
    const mint = Keypair.generate().publicKey;
    const steal = createTransferCheckedInstruction(PublicKey.unique(), mint, PublicKey.unique(), user, 1n, 6, [], TOKEN_2022_PROGRAM_ID);
    expect(verifyTradeMessage(compile([buyIx(1_000n, 900n), steal]), exp).join()).toMatch(/token instruction 12 is not allowed/);
  });
  it("rejects unknown programs and foreign fee payers", () => {
    const evil = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) });
    expect(verifyTradeMessage(compile([buyIx(1_000n, 900n), evil]), exp).join()).toMatch(/non-allowlisted/);
    const other = Keypair.generate().publicKey;
    expect(verifyTradeMessage(compile([buyIx(1_000n, 900n)], other), exp)).toContain("fee payer is not your wallet");
  });
});
