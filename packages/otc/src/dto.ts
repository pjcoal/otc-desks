/** API data-transfer types shared by server and client. All amounts are decimal integer strings. */
import type { OrderPayload } from "./schema";
import type { SettlementTermsJson } from "./settlement-tx";
import type { OrderStatus, SettlementStatus } from "./state";

export interface TokenRef {
  mint: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  decimals: number;
}

export interface OrderView {
  id: string;
  publicId: string;
  orderHash: string;
  status: OrderStatus;
  statusReason: string | null;
  side: "BUY" | "SELL";
  makerWallet: string;
  takerWallet: string | null;
  isPrivate: boolean;
  token: TokenRef;
  tokenProgram: string;
  tokenAmountRaw: string;
  quoteAmountRaw: string;
  filledAmountRaw: string;
  remainingAmountRaw: string;
  priceSolPerToken: string;
  allowPartialFill: boolean;
  minimumFillAmountRaw: string;
  platformFeeBps: number;
  feeMode: "BUYER_PAYS" | "SELLER_PAYS" | "SPLIT";
  note: string | null;
  createdAt: string;
  expiresAt: string;
  parentOrderId: string | null;
  rootOrderId: string;
  rootNegotiationId: string | null;
  revision: number;
  /** Reference price captured at receipt — an ESTIMATE, never an executable value. */
  refPriceSolPerToken: string | null;
  refPriceAt: string | null;
  /** Signed payload + signature so clients can verify the maker's signature themselves. */
  payload: OrderPayload;
  signature: string;
  isDemo: boolean;
}

export interface MarketRef {
  priceSolPerToken: string;
  at: string;
  venue: string;
}

export interface NegotiationView {
  id: string;
  rootOrderId: string;
  makerWallet: string;
  counterpartyWallet: string;
  status: "OPEN" | "AGREED" | "SETTLED" | "CLOSED";
  latestOrderId: string;
  revisions: OrderView[];
}

export interface SettlementView {
  id: string;
  orderId: string;
  status: SettlementStatus;
  attempt: number;
  seller: string;
  buyer: string;
  terms: SettlementTermsJson;
  grossQuoteLamports: string;
  buyerPaysLamports: string;
  netTokenReceivedRaw: string;
  messageBase64: string;
  messageHash: string;
  blockhash: string;
  lastValidBlockHeight: string;
  buyerSigned: boolean;
  sellerSigned: boolean;
  txSignature: string | null;
  failureReason: string | null;
  networkFeeEstimateLamports: string;
  createdAt: string;
}

export interface ReceiptView {
  signature: string;
  verified: boolean;
  verificationErrors: string[];
  status: "confirmed" | "finalized" | "failed" | "not_found";
  slot: number | null;
  blockTime: string | null;
  token: TokenRef | null;
  seller: string | null;
  buyer: string | null;
  tokenAmountRaw: string | null;
  netTokenReceivedRaw: string | null;
  sellerReceivedLamports: string | null;
  buyerPaidLamports: string | null;
  platformFeeLamports: string | null;
  referralFeeLamports: string | null;
  priceSolPerToken: string | null;
  refPriceSolPerToken: string | null;
  premiumDiscountPct: string | null;
  orderHash: string | null;
  memo: string | null;
  messageHashMatches: boolean | null;
}
