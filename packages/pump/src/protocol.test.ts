import * as PumpSdk from "@pump-fun/pump-sdk";
import { pumpAmmJson, PUMP_AMM_PROGRAM_ID as SWAP_AMM_ID } from "@pump-fun/pump-swap-sdk";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { toExactQuoteIn } from "./adapter";
import { AMM_DISCRIMINATORS, DISCRIMINATORS, MAYHEM_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from "./constants";
import { decodePumpIxData, encodeBuyExactQuoteInV2, encodeSellV2 } from "./ix-data";

type IdlIx = { name: string; discriminator: number[]; accounts: Array<{ name: string }>; args: Array<{ name: string; type: unknown }> };
const ixs = (PumpSdk.pumpIdl as unknown as { instructions: IdlIx[] }).instructions;
const byName = (n: string) => {
  const ix = ixs.find((i) => i.name === n);
  if (!ix) throw new Error(`IDL lost instruction ${n}`);
  return ix;
};

describe("protocol constants match the installed Pump SDKs", () => {
  it("program ids", () => {
    expect(PUMP_PROGRAM_ID.equals(PumpSdk.PUMP_PROGRAM_ID)).toBe(true);
    expect(PUMP_AMM_PROGRAM_ID.equals(PumpSdk.PUMP_AMM_PROGRAM_ID)).toBe(true);
    expect(PUMP_AMM_PROGRAM_ID.equals(SWAP_AMM_ID)).toBe(true);
    expect(PUMP_FEE_PROGRAM_ID.equals(PumpSdk.PUMP_FEE_PROGRAM_ID)).toBe(true);
    expect(MAYHEM_PROGRAM_ID.equals(PumpSdk.MAYHEM_PROGRAM_ID)).toBe(true);
    expect((pumpAmmJson as { address: string }).address).toBe(PUMP_AMM_PROGRAM_ID.toBase58());
  });

  it("instruction discriminators", () => {
    expect([...DISCRIMINATORS.createV2]).toEqual(byName("create_v2").discriminator);
    expect([...DISCRIMINATORS.buyV2]).toEqual(byName("buy_v2").discriminator);
    expect([...DISCRIMINATORS.buyExactQuoteInV2]).toEqual(byName("buy_exact_quote_in_v2").discriminator);
    expect([...DISCRIMINATORS.sellV2]).toEqual(byName("sell_v2").discriminator);
  });

  it("PumpSwap discriminators", () => {
    const amm = (pumpAmmJson as unknown as { instructions: IdlIx[] }).instructions;
    const d = (n: string) => amm.find((i) => i.name === n)!.discriminator;
    expect([...AMM_DISCRIMINATORS.buy]).toEqual(d("buy"));
    expect([...AMM_DISCRIMINATORS.sell]).toEqual(d("sell"));
    expect([...AMM_DISCRIMINATORS.buyExactQuoteIn]).toEqual(d("buy_exact_quote_in"));
  });

  it("buy_v2 and buy_exact_quote_in_v2 share an identical account list (required by toExactQuoteIn)", () => {
    expect(byName("buy_exact_quote_in_v2").accounts.map((a) => a.name)).toEqual(byName("buy_v2").accounts.map((a) => a.name));
  });

  it("v2 trade instructions take exactly two u64 arguments", () => {
    for (const n of ["buy_v2", "buy_exact_quote_in_v2", "sell_v2"]) {
      expect(byName(n).args.map((a) => a.type)).toEqual(["u64", "u64"]);
    }
  });
});

describe("instruction data codecs", () => {
  it("round-trips buy_exact_quote_in_v2 and sell_v2 with u64 extremes", () => {
    const max = 18_446_744_073_709_551_615n;
    const b = decodePumpIxData(encodeBuyExactQuoteInV2(max, 1n));
    expect(b).toEqual({ kind: "buy_exact_quote_in_v2", spendableQuoteIn: max, minTokensOut: 1n });
    const s = decodePumpIxData(encodeSellV2(123_456_789n, max));
    expect(s).toEqual({ kind: "sell_v2", amount: 123_456_789n, minSolOutput: max });
  });

  it("rejects unknown data", () => {
    expect(decodePumpIxData(new Uint8Array(24)).kind).toBe("unknown");
    expect(decodePumpIxData(new Uint8Array(3)).kind).toBe("unknown");
  });

  it("toExactQuoteIn keeps accounts and rewrites only the data", () => {
    const keys = [{ pubkey: PublicKey.unique(), isSigner: true, isWritable: true }];
    const data = Buffer.alloc(24);
    Buffer.from(DISCRIMINATORS.buyV2).copy(data);
    const ix = new TransactionInstruction({ programId: PUMP_PROGRAM_ID, keys, data });
    const out = toExactQuoteIn(ix, 5_000_000n, 42n);
    expect(out.keys).toBe(keys);
    expect(decodePumpIxData(out.data)).toEqual({ kind: "buy_exact_quote_in_v2", spendableQuoteIn: 5_000_000n, minTokensOut: 42n });
  });

  it("toExactQuoteIn refuses anything that is not a Pump buy_v2", () => {
    const other = new TransactionInstruction({ programId: PublicKey.unique(), keys: [], data: Buffer.from(DISCRIMINATORS.buyV2) });
    expect(() => toExactQuoteIn(other, 1n, 1n)).toThrow();
  });
});
