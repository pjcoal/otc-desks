import type { FeeMode } from "@app/shared";
import { randomHex16 } from "./canonical";
import { OTC_METADATA_VERSION, OTC_PROTOCOL_VERSION, SOL_QUOTE_MINT, type AcceptPayload, type CancelPayload, type OrderPayload, type OtcDomain } from "./schema";

export interface NewOrderInput {
  makerWallet: string;
  takerWallet: string | null;
  tokenMint: string;
  tokenProgram: string;
  tokenDecimals: number;
  side: "BUY" | "SELL";
  tokenAmountRaw: bigint;
  quoteAmountRaw: bigint;
  ttlSeconds: number;
  allowPartialFill: boolean;
  minimumFillAmountRaw?: bigint;
  platformFeeBps: number;
  feeMode: FeeMode;
  parentOrderHash?: string | null;
  note?: string | null;
}

/** Client-side helper: fresh order payload with random id/nonce/salt (the wallet then signs its message). */
export function newOrderPayload(domain: OtcDomain, i: NewOrderInput, nowSeconds = Math.floor(Date.now() / 1000)): OrderPayload {
  return {
    type: "otc-order",
    version: OTC_PROTOCOL_VERSION,
    orderId: randomHex16(),
    environment: domain.environment,
    network: domain.network,
    genesisHash: domain.genesisHash,
    makerWallet: i.makerWallet,
    takerWallet: i.takerWallet,
    tokenMint: i.tokenMint,
    tokenProgram: i.tokenProgram,
    tokenDecimals: i.tokenDecimals,
    side: i.side,
    tokenAmountRaw: i.tokenAmountRaw.toString(),
    quoteMint: SOL_QUOTE_MINT,
    quoteAmountRaw: i.quoteAmountRaw.toString(),
    createdAt: nowSeconds,
    expiresAt: nowSeconds + i.ttlSeconds,
    nonce: randomHex16(),
    salt: randomHex16(),
    allowPartialFill: i.allowPartialFill,
    minimumFillAmountRaw: (i.allowPartialFill ? (i.minimumFillAmountRaw ?? i.tokenAmountRaw) : i.tokenAmountRaw).toString(),
    platformFeeBps: i.platformFeeBps,
    feeMode: i.feeMode,
    parentOrderHash: i.parentOrderHash ?? null,
    note: i.note && i.note.trim() !== "" ? i.note.trim().normalize("NFC") : null,
    metadataVersion: OTC_METADATA_VERSION,
  };
}

export function newAcceptPayload(domain: OtcDomain, orderHash: string, acceptor: string, fillAmountRaw: bigint, quoteAmountRaw: bigint, nowSeconds = Math.floor(Date.now() / 1000)): AcceptPayload {
  return {
    type: "otc-accept",
    version: OTC_PROTOCOL_VERSION,
    environment: domain.environment,
    network: domain.network,
    genesisHash: domain.genesisHash,
    orderHash,
    acceptor,
    fillAmountRaw: fillAmountRaw.toString(),
    quoteAmountRaw: quoteAmountRaw.toString(),
    nonce: randomHex16(),
    signedAt: nowSeconds,
  };
}

export function newCancelPayload(domain: OtcDomain, orderHash: string, maker: string, nowSeconds = Math.floor(Date.now() / 1000)): CancelPayload {
  return {
    type: "otc-cancel",
    version: OTC_PROTOCOL_VERSION,
    environment: domain.environment,
    network: domain.network,
    genesisHash: domain.genesisHash,
    orderHash,
    maker,
    nonce: randomHex16(),
    signedAt: nowSeconds,
  };
}
