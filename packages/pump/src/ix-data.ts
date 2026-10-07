import { AMM_DISCRIMINATORS, DISCRIMINATORS } from "./constants";

function readU64(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i] ?? 0);
  return v;
}

function writeU64(out: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function hasPrefix(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

export type DecodedPumpIx =
  | { kind: "buy_v2"; amount: bigint; maxSolCost: bigint }
  | { kind: "buy_exact_quote_in_v2"; spendableQuoteIn: bigint; minTokensOut: bigint }
  | { kind: "sell_v2"; amount: bigint; minSolOutput: bigint }
  | { kind: "create_v2" }
  | { kind: "unknown" };

/** Decode the two-u64 argument layout shared by the v2 trade instructions. */
export function decodePumpIxData(data: Uint8Array): DecodedPumpIx {
  if (hasPrefix(data, DISCRIMINATORS.createV2)) return { kind: "create_v2" };
  if (data.length !== 24) return { kind: "unknown" };
  const a = readU64(data, 8);
  const b = readU64(data, 16);
  if (hasPrefix(data, DISCRIMINATORS.buyV2)) return { kind: "buy_v2", amount: a, maxSolCost: b };
  if (hasPrefix(data, DISCRIMINATORS.buyExactQuoteInV2)) return { kind: "buy_exact_quote_in_v2", spendableQuoteIn: a, minTokensOut: b };
  if (hasPrefix(data, DISCRIMINATORS.sellV2)) return { kind: "sell_v2", amount: a, minSolOutput: b };
  return { kind: "unknown" };
}

/** buy_exact_quote_in_v2(spendable_quote_in: u64, min_tokens_out: u64) */
export function encodeBuyExactQuoteInV2(spendableQuoteIn: bigint, minTokensOut: bigint): Uint8Array {
  const out = new Uint8Array(24);
  out.set(DISCRIMINATORS.buyExactQuoteInV2, 0);
  writeU64(out, 8, spendableQuoteIn);
  writeU64(out, 16, minTokensOut);
  return out;
}

/** sell_v2(amount: u64, min_sol_output: u64) */
export function encodeSellV2(amount: bigint, minSolOutput: bigint): Uint8Array {
  const out = new Uint8Array(24);
  out.set(DISCRIMINATORS.sellV2, 0);
  writeU64(out, 8, amount);
  writeU64(out, 16, minSolOutput);
  return out;
}

export type DecodedAmmIx =
  | { kind: "amm_buy"; baseAmountOut: bigint; maxQuoteAmountIn: bigint }
  | { kind: "amm_sell"; baseAmountIn: bigint; minQuoteAmountOut: bigint }
  | { kind: "unknown" };

/** pump-amm buy(base_amount_out, max_quote_amount_in, track_volume?) / sell(base_amount_in, min_quote_amount_out). */
export function decodeAmmIxData(data: Uint8Array): DecodedAmmIx {
  if (data.length < 24) return { kind: "unknown" };
  const a = readU64(data, 8);
  const b = readU64(data, 16);
  if (hasPrefix(data, AMM_DISCRIMINATORS.buy) && (data.length === 24 || data.length === 25 || data.length === 26)) return { kind: "amm_buy", baseAmountOut: a, maxQuoteAmountIn: b };
  if (hasPrefix(data, AMM_DISCRIMINATORS.sell) && data.length === 24) return { kind: "amm_sell", baseAmountIn: a, minQuoteAmountOut: b };
  return { kind: "unknown" };
}
