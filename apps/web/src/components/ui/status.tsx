import { Badge } from "./badge";

const ORDER: Record<string, { label: string; tone: "neutral" | "buy" | "sell" | "brass" | "glacier" | "warn" | "outline" }> = {
  DRAFT: { label: "Draft", tone: "outline" },
  OPEN: { label: "Open", tone: "glacier" },
  NEGOTIATING: { label: "Countered", tone: "brass" },
  ACCEPTED: { label: "Accepted", tone: "warn" },
  SETTLEMENT_READY: { label: "Awaiting signatures", tone: "warn" },
  PARTIALLY_FILLED: { label: "Partially filled", tone: "brass" },
  FILLED: { label: "Filled", tone: "buy" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  INVALIDATED: { label: "No longer valid", tone: "neutral" },
  FAILED: { label: "Failed", tone: "sell" },
  AWAITING_BUYER_SIGNATURE: { label: "Waiting for buyer", tone: "warn" },
  AWAITING_SELLER_SIGNATURE: { label: "Waiting for seller", tone: "warn" },
  READY_TO_SUBMIT: { label: "Ready to submit", tone: "warn" },
  SUBMITTED: { label: "Submitted", tone: "glacier" },
  CONFIRMED: { label: "Confirmed", tone: "buy" },
  FINALIZED: { label: "Finalized", tone: "buy" },
};

export function StatusPill({ status }: { status: string }) {
  const s = ORDER[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function SideBadge({ side }: { side: "BUY" | "SELL" }) {
  return <Badge tone={side === "BUY" ? "buy" : "sell"}>{side === "BUY" ? "Bid" : "Ask"}</Badge>;
}

export function VenueBadge({ venue }: { venue: string }) {
  if (venue === "PUMP_BONDING_CURVE") return <Badge tone="brass">Bonding curve</Badge>;
  if (venue === "PUMPSWAP") return <Badge tone="glacier">PumpSwap</Badge>;
  return <Badge tone="outline">No Pump market</Badge>;
}

