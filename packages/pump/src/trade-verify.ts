/**
 * Browser-side verification of a Pump / PumpSwap trade transaction prepared by our backend. The
 * wallet is only asked to sign if the message: is v0 with no lookup tables, has the user as the only
 * signer and fee payer, touches only allowlisted programs at the top level, and contains exactly one
 * Pump/PumpSwap trade instruction whose decoded limits equal the quote the user reviewed.
 */
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, MessageV0, PublicKey, SystemProgram, VersionedMessage } from "@solana/web3.js";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "./constants";
import { decodeAmmIxData, decodePumpIxData } from "./ix-data";

export interface TradeExpectation {
  user: string;
  side: "BUY" | "SELL";
  venue: "PUMP_BONDING_CURVE" | "PUMPSWAP";
  /** BUY on curve: spendable lamports; SELL: raw tokens in. */
  inputAmount: bigint;
  /** Worst-case limit shown to the user (min tokens/SOL out, or max SOL in for AMM buys). */
  minOutput: bigint;
  maxInput: bigint;
  expectedOutput: bigint;
  /** Extra top-level signers that are allowed (e.g. the client-generated mint for create). */
  extraSigners?: string[];
  allowCreate?: boolean;
  /** Launch without an initial buy: exactly one create_v2 and no trade instruction. */
  createOnly?: boolean;
  /** For launches: the client-generated mint that create_v2 must initialise. */
  mint?: string;
}

const ALLOWED = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  SystemProgram.programId.toBase58(),
  PUMP_PROGRAM_ID.toBase58(),
  PUMP_AMM_PROGRAM_ID.toBase58(),
]);

export function verifyTradeMessage(bytes: Uint8Array, exp: TradeExpectation): string[] {
  const problems: string[] = [];
  const msg = VersionedMessage.deserialize(bytes);
  if (!(msg instanceof MessageV0)) return ["transaction must be a v0 message"];
  if (msg.addressTableLookups.length > 0) problems.push("address lookup tables are not allowed");
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const signers = keys.slice(0, msg.header.numRequiredSignatures);
  if (signers[0] !== exp.user) problems.push("fee payer is not your wallet");
  const allowedSigners = new Set([exp.user, ...(exp.extraSigners ?? [])]);
  for (const s of signers) if (!allowedSigners.has(s)) problems.push(`unexpected signer ${s}`);

  const userWsol = getAssociatedTokenAddressSync(NATIVE_MINT, new PublicKey(exp.user), true, TOKEN_PROGRAM_ID).toBase58();
  let trades = 0;
  let creates = 0;
  for (const [i, ix] of msg.compiledInstructions.entries()) {
    const program = keys[ix.programIdIndex]!;
    if (!ALLOWED.has(program)) {
      problems.push(`instruction ${i} calls non-allowlisted program ${program}`);
      continue;
    }
    const acct = (n: number) => keys[ix.accountKeyIndexes[n] ?? -1];
    if (program === TOKEN_PROGRAM_ID.toBase58() || program === TOKEN_2022_PROGRAM_ID.toBase58()) {
      // Only WSOL housekeeping on the user's own accounts: SyncNative(17), CloseAccount(9) → user.
      const t = ix.data[0];
      const ok = t === 17 || (t === 9 && acct(1) === exp.user && acct(2) === exp.user);
      if (!ok) problems.push(`instruction ${i}: token instruction ${t} is not allowed in a trade`);
    }
    if (program === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      const t = ix.data.length === 0 ? 0 : ix.data[0];
      if ((t !== 0 && t !== 1) || acct(0) !== exp.user || acct(2) !== exp.user) problems.push(`instruction ${i}: ATA creation must be for your own wallet`);
    }
    if (program === SystemProgram.programId.toBase58()) {
      // Only wrapping SOL into the user's own WSOL account is acceptable (PumpSwap quote handling).
      const discriminator = ix.data[0] ?? 255;
      if (discriminator !== 2 || acct(0) !== exp.user || acct(1) !== userWsol) problems.push(`instruction ${i}: SOL may only move into your own wrapped-SOL account`);
    }
    if (program === PUMP_PROGRAM_ID.toBase58()) {
      const d = decodePumpIxData(ix.data);
      if (d.kind === "create_v2") {
        creates++;
        if (!exp.allowCreate) problems.push("unexpected token creation");
        if (exp.mint && keys[ix.accountKeyIndexes[0] ?? -1] !== exp.mint) problems.push("create_v2 targets a different mint");
        continue;
      }
      trades++;
      if (exp.venue !== "PUMP_BONDING_CURVE") problems.push("unexpected bonding-curve instruction");
      if (exp.side === "BUY") {
        if (d.kind !== "buy_exact_quote_in_v2" || d.spendableQuoteIn !== exp.inputAmount || d.minTokensOut !== exp.minOutput) problems.push("buy amounts differ from your quote");
      } else if (d.kind !== "sell_v2" || d.amount !== exp.inputAmount || d.minSolOutput !== exp.minOutput) problems.push("sell amounts differ from your quote");
    }
    if (program === PUMP_AMM_PROGRAM_ID.toBase58()) {
      trades++;
      const d = decodeAmmIxData(ix.data);
      if (exp.venue !== "PUMPSWAP") problems.push("unexpected PumpSwap instruction");
      if (exp.side === "BUY") {
        if (d.kind !== "amm_buy" || d.baseAmountOut !== exp.expectedOutput || d.maxQuoteAmountIn !== exp.maxInput) problems.push("buy amounts differ from your quote");
      } else if (d.kind !== "amm_sell" || d.baseAmountIn !== exp.inputAmount || d.minQuoteAmountOut !== exp.minOutput) problems.push("sell amounts differ from your quote");
    }
  }
  const expectedTrades = exp.createOnly ? 0 : 1;
  if (trades !== expectedTrades) problems.push(`expected ${expectedTrades} trade instruction(s), found ${trades}`);
  if (exp.allowCreate && creates !== 1) problems.push(`expected exactly one create_v2, found ${creates}`);
  return problems;
}
