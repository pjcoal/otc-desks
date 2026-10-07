import { formatUnits, SOL_DECIMALS } from "@app/shared";
import { hashPayload } from "./canonical";
import type { AcceptPayload, CancelPayload, OrderPayload } from "./schema";

/**
 * Human-readable messages that wallets display and sign. Each is a pure function of its payload —
 * no locale, no clock, no configuration — so any client can rebuild the exact bytes and verify a
 * signature independently. The final lines bind the text to the canonical hash and domain.
 */

const iso = (unix: number) => new Date(unix * 1000).toISOString().replace(".000Z", "Z");
const tokens = (raw: string, decimals: number) => `${formatUnits(BigInt(raw), decimals, { group: true })} (raw ${raw}, ${decimals} decimals)`;
const sol = (raw: string) => `${formatUnits(BigInt(raw), SOL_DECIMALS, { group: true })} SOL (${raw} lamports)`;

const FEE_MODE_TEXT = { SELLER_PAYS: "paid by seller", BUYER_PAYS: "paid by buyer", SPLIT: "split 50/50" } as const;

function domainLines(p: { environment: string; network: string; genesisHash: string }): string[] {
  return [`Domain: ${p.environment}`, `Network: ${p.network} (genesis ${p.genesisHash})`];
}

export function buildOrderMessage(p: OrderPayload): string {
  const verb = p.side === "SELL" ? "SELL" : "BUY";
  return [
    `OTC ${p.parentOrderHash ? "counteroffer" : "order"} — ${p.environment}`,
    "Signing publishes this order. It is free and does not move any funds.",
    "Funds move only if you later approve a settlement transaction.",
    "",
    `Side: ${verb}`,
    `Token mint: ${p.tokenMint}`,
    `Token program: ${p.tokenProgram}`,
    `Token amount: ${tokens(p.tokenAmountRaw, p.tokenDecimals)}`,
    `Total price: ${sol(p.quoteAmountRaw)}`,
    `Maker: ${p.makerWallet}`,
    `Counterparty: ${p.takerWallet ?? "anyone (public order)"}`,
    `Partial fills: ${p.allowPartialFill ? `allowed, minimum ${tokens(p.minimumFillAmountRaw, p.tokenDecimals)}` : "not allowed"}`,
    `Platform fee: ${p.platformFeeBps} bps, ${FEE_MODE_TEXT[p.feeMode]}`,
    `Created: ${iso(p.createdAt)}`,
    `Expires: ${iso(p.expiresAt)}`,
    ...(p.parentOrderHash ? [`Counter to order: ${p.parentOrderHash}`] : []),
    ...(p.note ? [`Note: ${p.note}`] : []),
    "",
    `Order ID: ${p.orderId}`,
    `Nonce: ${p.nonce}`,
    `Salt: ${p.salt}`,
    ...domainLines(p),
    `Order hash: ${hashPayload(p)}`,
  ].join("\n");
}

export function buildAcceptMessage(p: AcceptPayload, order: Pick<OrderPayload, "tokenMint" | "tokenDecimals" | "side">): string {
  const acceptorBuys = order.side === "SELL";
  return [
    `OTC acceptance — ${p.environment}`,
    "Signing records your acceptance. It is free and does not move any funds.",
    "You will review and approve the exact settlement transaction next.",
    "",
    `Order hash: ${p.orderHash}`,
    `Accepting wallet: ${p.acceptor}`,
    `Token mint: ${order.tokenMint}`,
    `You ${acceptorBuys ? "buy" : "sell"}: ${tokens(p.fillAmountRaw, order.tokenDecimals)}`,
    `You ${acceptorBuys ? "pay" : "receive"} (before platform fee): ${sol(p.quoteAmountRaw)}`,
    `Signed at: ${iso(p.signedAt)}`,
    `Nonce: ${p.nonce}`,
    ...domainLines(p),
    `Acceptance hash: ${hashPayload(p)}`,
  ].join("\n");
}

export function buildCancelMessage(p: CancelPayload): string {
  return [
    `OTC cancellation — ${p.environment}`,
    "Signing cancels your order. It is free and does not move any funds.",
    "A settlement transaction you have ALREADY signed stays valid until its blockhash expires (about 60–90 seconds).",
    "",
    `Cancel order: ${p.orderHash}`,
    `Maker: ${p.maker}`,
    `Signed at: ${iso(p.signedAt)}`,
    `Nonce: ${p.nonce}`,
    ...domainLines(p),
    `Cancellation hash: ${hashPayload(p)}`,
  ].join("\n");
}
