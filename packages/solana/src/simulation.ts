import { SystemProgram, type PublicKey, type TransactionError } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { ErrorCode } from "@app/shared";

export interface DecodedTxError {
  code: ErrorCode;
  message: string;
  instructionIndex?: number;
  programId?: string;
  customCode?: number;
  /** Raw program error name when known (e.g. "TooMuchSolRequired"). */
  programError?: string;
}

export type ProgramErrorTable = Record<number, { name: string; code: ErrorCode; message?: string }>;

export interface DecodeContext {
  /** Program id invoked by each top-level instruction, by index. */
  instructionPrograms: PublicKey[];
  /** Extra per-program custom error tables (e.g. Pump IDL errors). */
  programErrors?: Record<string, ProgramErrorTable>;
  /** Override the meaning of a token-program InsufficientFunds error (who ran out). */
  tokenInsufficientFunds?: ErrorCode;
  /** Override the meaning of a system-program lamport shortfall. */
  systemInsufficientFunds?: ErrorCode;
}

// spl-token / token-2022 TokenError discriminants (shared by both programs for these values).
const TOKEN_ERRORS: Record<number, { name: string; code?: ErrorCode; message: string }> = {
  0: { name: "NotRentExempt", message: "Token account is not rent exempt." },
  1: { name: "InsufficientFunds", message: "Insufficient token balance." },
  2: { name: "InvalidMint", message: "Invalid mint." },
  3: { name: "MintMismatch", message: "Token account mint does not match.", code: "TOKEN_PROGRAM_MISMATCH" },
  4: { name: "OwnerMismatch", message: "Token account owner does not match the signer." },
  17: { name: "AccountFrozen", message: "Token account is frozen.", code: "SELLER_ACCOUNT_FROZEN" },
  18: { name: "MintDecimalsMismatch", message: "Mint decimals do not match the signed amount." },
  36: { name: "NoMemo", message: "Recipient requires a memo with incoming transfers." },
  37: { name: "NonTransferable", message: "Token is non-transferable.", code: "TOKEN_UNSUPPORTED_EXTENSION" },
  44: { name: "FeeMismatch", message: "Token transfer fee changed since the transaction was built.", code: "TX_CHANGED" },
};

function isInstructionError(err: TransactionError): err is { InstructionError: [number, unknown] } {
  return typeof err === "object" && err !== null && "InstructionError" in err;
}

export function decodeTransactionError(err: TransactionError | null, logs: string[] | null, ctx: DecodeContext): DecodedTxError | null {
  if (err === null) return null;
  const logText = (logs ?? []).join("\n");

  if (typeof err === "string") {
    switch (err) {
      case "BlockhashNotFound":
        return { code: "BLOCKHASH_EXPIRED", message: "The transaction blockhash expired. Please rebuild and sign again." };
      case "InsufficientFundsForFee":
      case "AccountNotFound":
        return { code: ctx.systemInsufficientFunds ?? "BUYER_INSUFFICIENT_SOL", message: "Fee payer does not have enough SOL to pay network fees." };
      case "AlreadyProcessed":
        return { code: "ORDER_FILLED", message: "This transaction was already processed." };
      default:
        return { code: "SIMULATION_FAILED", message: `Transaction failed: ${err}` };
    }
  }

  if (typeof err === "object" && err !== null && "InsufficientFundsForRent" in err) {
    return { code: "SELLER_CANNOT_RECEIVE", message: "A recipient account would be left below the rent-exempt minimum." };
  }

  if (isInstructionError(err)) {
    const [index, inner] = err.InstructionError;
    const program = ctx.instructionPrograms[index];
    const programId = program?.toBase58();
    const custom = typeof inner === "object" && inner !== null && "Custom" in inner ? Number((inner as { Custom: number }).Custom) : undefined;

    if (program && custom !== undefined) {
      const table = ctx.programErrors?.[program.toBase58()];
      const entry = table?.[custom];
      if (entry) {
        return { code: entry.code, message: entry.message ?? entry.name, instructionIndex: index, programId, customCode: custom, programError: entry.name };
      }
      if (program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID)) {
        const t = TOKEN_ERRORS[custom];
        if (t) {
          const code = custom === 1 ? (ctx.tokenInsufficientFunds ?? "SELLER_INSUFFICIENT_TOKENS") : (t.code ?? "SIMULATION_FAILED");
          return { code, message: t.message, instructionIndex: index, programId, customCode: custom, programError: t.name };
        }
      }
      if (program.equals(SystemProgram.programId) && custom === 1) {
        return { code: ctx.systemInsufficientFunds ?? "BUYER_INSUFFICIENT_SOL", message: "Not enough SOL for this transfer.", instructionIndex: index, programId, customCode: custom };
      }
    }
    if (/insufficient lamports/i.test(logText)) {
      return { code: ctx.systemInsufficientFunds ?? "BUYER_INSUFFICIENT_SOL", message: "Not enough SOL for this transaction.", instructionIndex: index, programId };
    }
    const innerText = typeof inner === "string" ? inner : JSON.stringify(inner);
    return { code: "SIMULATION_FAILED", message: `Instruction ${index} failed: ${innerText}`, instructionIndex: index, programId, ...(custom !== undefined ? { customCode: custom } : {}) };
  }

  return { code: "SIMULATION_FAILED", message: `Transaction failed: ${JSON.stringify(err)}` };
}
