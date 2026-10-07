"use client";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  buildAcceptMessage,
  buildCancelMessage,
  buildOrderMessage,
  checkFill,
  computeSettlementAmounts,
  effectiveFeeBps,
  newAcceptPayload,
  newCancelPayload,
  newOrderPayload,
  quoteForFill,
  termsFromJson,
  verifyOrder,
  verifySettlementMessage,
  type DecodedSettlement,
  type NewOrderInput,
  type OrderView,
  type SettlementView,
} from "@app/otc";
import { fromBase64 } from "@app/solana";
import type { PublicConfig } from "@/server/context";
import { post } from "./api";
import { signText } from "./signing";

export async function publishOrder(wallet: WalletContextState, cfg: PublicConfig, input: Omit<NewOrderInput, "makerWallet" | "platformFeeBps" | "feeMode">, parent?: OrderView): Promise<OrderView> {
  const payload = newOrderPayload(cfg.otcDomain, { ...input, makerWallet: wallet.publicKey!.toBase58(), platformFeeBps: cfg.platformFeeBps, feeMode: cfg.feeMode, parentOrderHash: parent?.orderHash ?? null });
  const signature = await signText(wallet, buildOrderMessage(payload));
  return parent ? post<OrderView>(`/api/otc/orders/${parent.id}/counter`, { payload, signature }) : post<OrderView>("/api/otc/orders", { payload, signature });
}

export async function acceptOrder(wallet: WalletContextState, cfg: PublicConfig, order: OrderView, fill: bigint): Promise<OrderView> {
  const gross = quoteForFill({ side: order.side, tokenAmountRaw: BigInt(order.tokenAmountRaw), quoteAmountRaw: BigInt(order.quoteAmountRaw) }, BigInt(order.filledAmountRaw), fill);
  const payload = newAcceptPayload(cfg.otcDomain, order.orderHash, wallet.publicKey!.toBase58(), fill, gross);
  const signature = await signText(wallet, buildAcceptMessage(payload, { tokenMint: order.token.mint, tokenDecimals: order.token.decimals, side: order.side }));
  return post<OrderView>(`/api/otc/orders/${order.id}/accept`, { payload, signature });
}

export async function cancelOrder(wallet: WalletContextState, cfg: PublicConfig, order: OrderView): Promise<OrderView> {
  const payload = newCancelPayload(cfg.otcDomain, order.orderHash, wallet.publicKey!.toBase58());
  const signature = await signText(wallet, buildCancelMessage(payload));
  return post<OrderView>(`/api/otc/orders/${order.id}/cancel`, { payload, signature });
}

/** Verify the maker's signature over the order in the browser, independently of the server. */
export function orderSignatureValid(cfg: PublicConfig, order: OrderView): boolean {
  const r = verifyOrder(order.payload, order.signature, cfg.otcDomain);
  return r.ok && r.value.orderHash === order.orderHash;
}

export interface SettlementCheck {
  ok: boolean;
  problems: string[];
  decoded: DecodedSettlement | null;
  role: "buyer" | "seller" | null;
}

/**
 * Before the wallet signs a settlement: recompute what the terms MUST be from the maker-signed order
 * (parties, mint, program, decimals, price for this fill, fee no higher than signed, our published
 * treasury), then require the transaction bytes to be exactly the canonical settlement for them.
 */
export function checkSettlement(cfg: PublicConfig, order: OrderView, s: SettlementView, me: string): SettlementCheck {
  try {
    return checkSettlementUnsafe(cfg, order, s, me);
  } catch (e) {
    return { ok: false, problems: [e instanceof Error ? e.message : String(e)], decoded: null, role: null };
  }
}

function checkSettlementUnsafe(cfg: PublicConfig, order: OrderView, s: SettlementView, me: string): SettlementCheck {
  const problems: string[] = [];
  const t = termsFromJson(s.terms);
  if (!orderSignatureValid(cfg, order)) problems.push("The maker's order signature does not verify.");
  const acceptor = order.side === "SELL" ? t.buyer : t.seller;
  const expectedSeller = order.side === "SELL" ? order.makerWallet : acceptor;
  const expectedBuyer = order.side === "SELL" ? acceptor : order.makerWallet;
  if (t.seller !== expectedSeller || t.buyer !== expectedBuyer) problems.push("Buyer/seller do not match the signed order.");
  if (order.takerWallet && acceptor !== order.takerWallet) problems.push("Counterparty is not the wallet this private offer was addressed to.");
  if (t.tokenMint !== order.payload.tokenMint || t.tokenProgram !== order.payload.tokenProgram || t.tokenDecimals !== order.payload.tokenDecimals) problems.push("Token differs from the signed order.");
  if (t.orderHash !== order.orderHash) problems.push("Settlement is bound to a different order.");
  const fill = t.tokenAmountRaw;
  const fc = checkFill({ allowPartialFill: order.allowPartialFill, tokenAmountRaw: BigInt(order.tokenAmountRaw), minimumFillAmountRaw: BigInt(order.minimumFillAmountRaw) }, BigInt(order.filledAmountRaw), fill);
  if (!fc.ok) problems.push("Fill size is not allowed by the signed order.");
  const gross = quoteForFill({ side: order.side, tokenAmountRaw: BigInt(order.tokenAmountRaw), quoteAmountRaw: BigInt(order.quoteAmountRaw) }, BigInt(order.filledAmountRaw), fill);
  const feeBps = effectiveFeeBps(order.payload.platformFeeBps, cfg.platformFeeBps);
  const expected = computeSettlementAmounts({ grossQuote: gross, feeBps, feeMode: order.payload.feeMode, referralShareBps: cfg.referralShareBps, hasReferrer: t.referrerWallet !== null });
  if (t.sellerReceivesLamports !== expected.sellerReceives) problems.push("SOL paid to the seller differs from the signed price and fee.");
  if (t.platformFeeLamports + t.referralFeeLamports > expected.totalFee) problems.push("Platform fee exceeds the agreed fee.");
  if (t.platformFeeLamports > 0n && t.treasuryWallet !== cfg.treasuryWallet) problems.push("Fee recipient is not the published platform treasury.");
  if (BigInt(s.buyerPaysLamports) !== expected.buyerPays) problems.push("Buyer payment differs from the signed price and fee.");
  let decoded: DecodedSettlement | null = null;
  try {
    decoded = verifySettlementMessage(fromBase64(s.messageBase64), t);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  const role = me === t.buyer ? "buyer" : me === t.seller ? "seller" : null;
  if (!role) problems.push("Your wallet is not a party to this settlement.");
  return { ok: problems.length === 0, problems, decoded, role };
}

export type { NewOrderInput };
