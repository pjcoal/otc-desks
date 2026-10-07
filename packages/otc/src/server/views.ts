import { big, type OtcNegotiation, type OtcOrder, type OtcSettlement, type Token } from "@app/database";
import { toBase64, estimateNetworkFeeLamports } from "@app/solana";
import type { NegotiationView, OrderView, SettlementView, TokenRef } from "../dto";
import type { OrderPayload } from "../schema";
import type { OrderStatus, SettlementStatus } from "../state";
import type { SettlementTermsJson } from "../settlement-tx";

export function tokenRef(t: Pick<Token, "mint" | "symbol" | "name" | "imageUrl" | "decimals"> | null, mint: string, decimals: number): TokenRef {
  return t ? { mint: t.mint, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl, decimals: t.decimals } : { mint, symbol: "", name: "", imageUrl: null, decimals };
}

export function payloadOf(o: OtcOrder): OrderPayload {
  return {
    type: "otc-order",
    version: o.version as 1,
    orderId: o.id,
    environment: o.environment,
    network: o.network as OrderPayload["network"],
    genesisHash: o.genesisHash,
    makerWallet: o.makerWallet,
    takerWallet: o.takerWallet,
    tokenMint: o.tokenMint,
    tokenProgram: o.tokenProgram,
    tokenDecimals: o.tokenDecimals,
    side: o.side,
    tokenAmountRaw: big(o.tokenAmountRaw).toString(),
    quoteMint: "SOL",
    quoteAmountRaw: big(o.quoteAmountRaw).toString(),
    createdAt: Math.floor(o.createdAt.getTime() / 1000),
    expiresAt: Math.floor(o.expiresAt.getTime() / 1000),
    nonce: o.nonce,
    salt: o.salt,
    allowPartialFill: o.allowPartialFill,
    minimumFillAmountRaw: big(o.minimumFillAmountRaw).toString(),
    platformFeeBps: o.platformFeeBps,
    feeMode: o.feeMode,
    parentOrderHash: null, // filled by caller when known (stored via parent relation)
    note: o.note,
    metadataVersion: o.metadataVersion as 1,
  };
}

export function orderView(o: OtcOrder & { token?: Token | null; parentOrder?: { orderHash: string } | null }): OrderView {
  const total = big(o.tokenAmountRaw);
  const filled = big(o.filledAmountRaw);
  return {
    id: o.id,
    publicId: o.publicId,
    orderHash: o.orderHash,
    status: o.status as OrderStatus,
    statusReason: o.statusReason,
    side: o.side,
    makerWallet: o.makerWallet,
    takerWallet: o.takerWallet,
    isPrivate: o.takerWallet !== null,
    token: tokenRef(o.token ?? null, o.tokenMint, o.tokenDecimals),
    tokenProgram: o.tokenProgram,
    tokenAmountRaw: total.toString(),
    quoteAmountRaw: big(o.quoteAmountRaw).toString(),
    filledAmountRaw: filled.toString(),
    remainingAmountRaw: (total - filled).toString(),
    priceSolPerToken: o.priceDecimal.toFixed(),
    allowPartialFill: o.allowPartialFill,
    minimumFillAmountRaw: big(o.minimumFillAmountRaw).toString(),
    platformFeeBps: o.platformFeeBps,
    feeMode: o.feeMode,
    note: o.note,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    parentOrderId: o.parentOrderId,
    rootOrderId: o.rootOrderId,
    rootNegotiationId: o.rootNegotiationId,
    revision: o.revision,
    refPriceSolPerToken: o.refPriceSolPerToken?.toFixed() ?? null,
    refPriceAt: o.refPriceAt?.toISOString() ?? null,
    payload: { ...payloadOf(o), parentOrderHash: o.parentOrder?.orderHash ?? null },
    signature: o.signature,
    isDemo: o.isDemo,
  };
}

export function negotiationView(n: OtcNegotiation, revisions: Parameters<typeof orderView>[0][]): NegotiationView {
  return {
    id: n.id,
    rootOrderId: n.rootOrderId,
    makerWallet: n.makerWallet,
    counterpartyWallet: n.counterpartyWallet,
    status: n.status,
    latestOrderId: n.latestOrderId,
    revisions: revisions.map(orderView),
  };
}

export function settlementView(s: OtcSettlement, terms: SettlementTermsJson, microLamports: number): SettlementView {
  return {
    id: s.id,
    orderId: s.orderId,
    status: s.status as SettlementStatus,
    attempt: s.attempt,
    seller: s.sellerWallet,
    buyer: s.buyerWallet,
    terms,
    grossQuoteLamports: big(s.grossQuoteLamports).toString(),
    buyerPaysLamports: big(s.buyerPaysLamports).toString(),
    netTokenReceivedRaw: big(s.netTokenReceivedRaw).toString(),
    messageBase64: toBase64(s.messageBytes),
    messageHash: s.messageHash,
    blockhash: s.blockhash,
    lastValidBlockHeight: s.lastValidBlockHeight.toString(),
    buyerSigned: s.buyerSignature !== null,
    sellerSigned: s.sellerSignature !== null,
    txSignature: s.txSignature,
    failureReason: s.failureReason,
    networkFeeEstimateLamports: estimateNetworkFeeLamports(2, terms.computeUnitLimit, microLamports).toString(),
    createdAt: s.createdAt.toISOString(),
  };
}

/** Private orders are visible only to their two parties. Returns false ⇒ respond 404 (do not leak existence). */
export function canView(o: Pick<OtcOrder, "makerWallet" | "takerWallet">, viewer: string | null): boolean {
  if (o.takerWallet === null) return true;
  return viewer !== null && (viewer === o.makerWallet || viewer === o.takerWallet);
}
