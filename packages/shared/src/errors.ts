/**
 * Error catalog. Every user-visible failure has a stable code and a specific message — never a
 * generic "transaction failed" when we know the reason.
 */
export const ERRORS = {
  // Auth & access
  UNAUTHENTICATED: { status: 401, message: "Connect and sign in with your wallet to continue." },
  FORBIDDEN: { status: 403, message: "Your wallet is not authorized for this action." },
  NONCE_INVALID: { status: 401, message: "This sign-in request expired or was already used. Please try again." },
  SIGNATURE_INVALID: { status: 401, message: "The wallet signature could not be verified." },
  CSRF_REJECTED: { status: 403, message: "Request origin rejected." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please wait a moment and retry." },
  REGION_BLOCKED: { status: 451, message: "This service is not available in your region." },
  VALIDATION: { status: 400, message: "Some fields are invalid." },
  NOT_FOUND: { status: 404, message: "Not found." },

  // Network / safety guards
  MAINNET_DISABLED: { status: 403, message: "Mainnet transactions are disabled on this deployment." },
  NETWORK_MISMATCH: { status: 400, message: "This order was signed for a different network." },
  RPC_UNAVAILABLE: { status: 503, message: "Solana RPC is temporarily unavailable. Please retry shortly." },

  // OTC order lifecycle
  ORDER_EXPIRED: { status: 409, message: "This offer expired." },
  ORDER_FILLED: { status: 409, message: "This order has already been filled." },
  ORDER_CANCELLED: { status: 409, message: "This order was cancelled by its maker." },
  ORDER_INVALIDATED: { status: 409, message: "This order is no longer valid." },
  ORDER_NOT_ACCEPTABLE: { status: 409, message: "This order cannot be accepted in its current state." },
  ORDER_NOT_LATEST_REVISION: { status: 409, message: "A newer counteroffer exists. Review the latest terms." },
  ORDER_DUPLICATE: { status: 409, message: "An identical order already exists." },
  NONCE_REUSED: { status: 409, message: "This order nonce was already used by your wallet." },
  SELF_TRADE: { status: 400, message: "You cannot trade with your own order." },
  NOT_COUNTERPARTY: { status: 403, message: "Only the designated wallet can act on this private offer." },
  FILL_TOO_SMALL: { status: 400, message: "Fill amount is below this order's minimum." },
  FILL_TOO_LARGE: { status: 400, message: "Fill amount exceeds the remaining quantity." },
  FEE_MISMATCH: { status: 400, message: "Order fee terms do not match this platform's current fee schedule." },

  // Settlement
  SELLER_INSUFFICIENT_TOKENS: { status: 409, message: "Seller no longer owns enough tokens." },
  BUYER_INSUFFICIENT_SOL: { status: 409, message: "Buyer no longer has enough SOL." },
  SELLER_ACCOUNT_FROZEN: { status: 409, message: "The seller's token account is frozen." },
  SELLER_CANNOT_RECEIVE: {
    status: 409,
    message: "The seller's wallet has no SOL and cannot receive less than the rent-exempt minimum.",
  },
  TOKEN_UNSUPPORTED_EXTENSION: { status: 422, message: "Token uses an unsupported transfer extension." },
  TOKEN_PROGRAM_MISMATCH: { status: 409, message: "The token's program does not match the signed order." },
  TX_CHANGED: { status: 409, message: "The transaction changed and must be signed again." },
  BLOCKHASH_EXPIRED: { status: 409, message: "The transaction expired before all signatures were collected. Both parties must sign again." },
  SETTLEMENT_IN_PROGRESS: { status: 409, message: "A settlement for this order is already in progress." },
  SETTLEMENT_NOT_READY: { status: 409, message: "This settlement is not ready for that step." },
  SIMULATION_FAILED: { status: 422, message: "Transaction simulation failed." },
  TX_NOT_FOUND: { status: 404, message: "Transaction not found on chain." },
  TX_VERIFICATION_FAILED: { status: 422, message: "On-chain transaction does not match the agreed settlement." },

  // Pump market
  QUOTE_STALE: { status: 409, message: "Pump quote changed beyond your slippage setting." },
  VENUE_UNAVAILABLE: { status: 409, message: "This token has no tradable Pump market right now." },
  UNSUPPORTED_QUOTE_MINT: { status: 422, message: "Only SOL-quoted Pump markets are supported." },
  CURVE_COMPLETE: { status: 409, message: "The bonding curve is complete; trading moves to PumpSwap after migration." },
  UPLOAD_REJECTED: { status: 400, message: "That file could not be accepted." },
  METADATA_UNAVAILABLE: { status: 503, message: "Metadata storage is not configured." },

  INTERNAL: { status: 500, message: "Something went wrong on our side." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERRORS;

export class AppError extends Error {
  override name = "AppError";
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERRORS[code].message);
    this.code = code;
    this.status = ERRORS[code].status;
    this.details = details;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: unknown } } {
    return { error: { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) } };
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
