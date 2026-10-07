/**
 * Explicit OTC order state machine. The server is the only writer; every transition is persisted
 * with an audit event (see server/transitions.ts). UI state is always derived from this, never the
 * other way round.
 */
export const ORDER_STATUSES = [
  "DRAFT",
  "OPEN",
  "NEGOTIATING",
  "ACCEPTED",
  "SETTLEMENT_READY",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "EXPIRED",
  "INVALIDATED",
  "FAILED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(["FILLED", "CANCELLED", "EXPIRED", "INVALIDATED", "FAILED"]);

/** Statuses from which a counterparty may accept (subject to revision/role checks). */
export const ACCEPTABLE_STATUSES: ReadonlySet<OrderStatus> = new Set(["OPEN", "PARTIALLY_FILLED"]);

/** Statuses a maker may cancel from. */
export const CANCELLABLE_STATUSES: ReadonlySet<OrderStatus> = new Set(["OPEN", "NEGOTIATING", "ACCEPTED", "SETTLEMENT_READY", "PARTIALLY_FILLED"]);

const T: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["NEGOTIATING", "ACCEPTED", "CANCELLED", "EXPIRED", "INVALIDATED"],
  // A counter supersedes this revision; the thread may close (INVALIDATED) or the maker may cancel.
  NEGOTIATING: ["OPEN", "CANCELLED", "EXPIRED", "INVALIDATED"],
  ACCEPTED: ["SETTLEMENT_READY", "OPEN", "PARTIALLY_FILLED", "CANCELLED", "EXPIRED", "INVALIDATED"],
  SETTLEMENT_READY: ["FILLED", "PARTIALLY_FILLED", "ACCEPTED", "OPEN", "FAILED", "CANCELLED", "EXPIRED", "INVALIDATED"],
  PARTIALLY_FILLED: ["ACCEPTED", "CANCELLED", "EXPIRED", "FILLED", "INVALIDATED"],
  FILLED: [],
  // On-chain proof overrides: a transaction both parties signed BEFORE a cancel/expiry may still land
  // inside its blockhash window. The reconciler records reality (FILLED / PARTIALLY_FILLED) with a reason.
  CANCELLED: ["FILLED", "PARTIALLY_FILLED"],
  EXPIRED: ["FILLED", "PARTIALLY_FILLED"],
  INVALIDATED: ["FILLED", "PARTIALLY_FILLED"],
  FAILED: [],
};

/** Transitions out of terminal states are only legal with on-chain proof. */
export const CHAIN_PROOF_ONLY: ReadonlySet<string> = new Set(
  (["CANCELLED", "EXPIRED", "INVALIDATED"] as const).flatMap((from) => (["FILLED", "PARTIALLY_FILLED"] as const).map((to) => `${from}->${to}`)),
);

export function canTransition(from: OrderStatus, to: OrderStatus, opts: { chainProof?: boolean } = {}): boolean {
  if (!T[from].includes(to)) return false;
  if (CHAIN_PROOF_ONLY.has(`${from}->${to}`) && !opts.chainProof) return false;
  return true;
}

/** All statuses that may legally move to `to` (used for optimistic `WHERE status IN (...)` updates). */
export function fromStatusesFor(to: OrderStatus, opts: { chainProof?: boolean } = {}): OrderStatus[] {
  return ORDER_STATUSES.filter((s) => canTransition(s, to, opts));
}

export const SETTLEMENT_STATUSES = [
  "AWAITING_BUYER_SIGNATURE",
  "AWAITING_SELLER_SIGNATURE",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "CONFIRMED",
  "FINALIZED",
  "FAILED",
  "EXPIRED",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const LIVE_SETTLEMENT_STATUSES: ReadonlySet<SettlementStatus> = new Set(["AWAITING_BUYER_SIGNATURE", "AWAITING_SELLER_SIGNATURE", "READY_TO_SUBMIT", "SUBMITTED"]);
