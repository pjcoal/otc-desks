import { pumpIdl } from "@pump-fun/pump-sdk";
import { pumpAmmJson } from "@pump-fun/pump-swap-sdk";
import type { ErrorCode } from "@app/shared";
import type { ProgramErrorTable } from "@app/solana";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "./constants";

type IdlError = { code: number; name: string; msg?: string };

/** Program errors that map to a specific user-facing error code; everything else is SIMULATION_FAILED. */
const SPECIFIC: Record<string, ErrorCode> = {
  TooMuchSolRequired: "QUOTE_STALE",
  TooLittleSolReceived: "QUOTE_STALE",
  BuySlippageBelowMinTokensOut: "QUOTE_STALE",
  ExceededSlippage: "QUOTE_STALE",
  BondingCurveComplete: "CURVE_COMPLETE",
  NotEnoughTokensToSell: "SELLER_INSUFFICIENT_TOKENS",
  NotEnoughTokensToBuy: "QUOTE_STALE",
  BuyNotEnoughSolToCoverRent: "BUYER_INSUFFICIENT_SOL",
  InsufficientFunds: "BUYER_INSUFFICIENT_SOL",
  UnsupportedQuoteMint: "UNSUPPORTED_QUOTE_MINT",
};

function table(errors: IdlError[] | undefined): ProgramErrorTable {
  const t: ProgramErrorTable = {};
  for (const e of errors ?? []) {
    const msg = e.msg ? `${e.name}: ${e.msg}` : e.name;
    const specific = SPECIFIC[e.name];
    // Specific codes use our curated message; unknown program errors surface the program's own text.
    t[e.code] = specific ? { name: e.name, code: specific } : { name: e.name, code: "SIMULATION_FAILED", message: msg };
  }
  return t;
}

export const PUMP_PROGRAM_ERRORS: Record<string, ProgramErrorTable> = {
  [PUMP_PROGRAM_ID.toBase58()]: table((pumpIdl as unknown as { errors: IdlError[] }).errors),
  [PUMP_AMM_PROGRAM_ID.toBase58()]: table((pumpAmmJson as unknown as { errors: IdlError[] }).errors),
};
