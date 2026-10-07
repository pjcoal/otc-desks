import { BPS_DENOMINATOR, SOL_DECIMALS, bpsOf, mulDivCeil, mulDivFloor, premiumDiscountPct, unitPrice, type Dec, type FeeMode } from "@app/shared";

/**
 * Quote owed for cumulative fill `x` of an order (q(x)). Rounding always favours the MAKER, who set
 * the price: a selling maker is paid ceil, a buying maker pays floor. q(total) == quoteAmountRaw.
 */
export function cumulativeQuote(side: "BUY" | "SELL", tokenAmountRaw: bigint, quoteAmountRaw: bigint, cumulativeFill: bigint): bigint {
  if (cumulativeFill < 0n || cumulativeFill > tokenAmountRaw) throw new Error("fill out of range");
  if (cumulativeFill === tokenAmountRaw) return quoteAmountRaw;
  return side === "SELL" ? mulDivCeil(quoteAmountRaw, cumulativeFill, tokenAmountRaw) : mulDivFloor(quoteAmountRaw, cumulativeFill, tokenAmountRaw);
}

/**
 * Quote for the next fill, computed as q(filled + fill) − q(filled), so a sequence of partial fills
 * sums to exactly the signed total with no rounding drift.
 */
export function quoteForFill(order: { side: "BUY" | "SELL"; tokenAmountRaw: bigint; quoteAmountRaw: bigint }, alreadyFilled: bigint, fill: bigint): bigint {
  return (
    cumulativeQuote(order.side, order.tokenAmountRaw, order.quoteAmountRaw, alreadyFilled + fill) -
    cumulativeQuote(order.side, order.tokenAmountRaw, order.quoteAmountRaw, alreadyFilled)
  );
}

export interface FillCheck {
  ok: boolean;
  code?: "FILL_TOO_SMALL" | "FILL_TOO_LARGE";
}

export function checkFill(order: { allowPartialFill: boolean; tokenAmountRaw: bigint; minimumFillAmountRaw: bigint }, alreadyFilled: bigint, fill: bigint): FillCheck {
  const remaining = order.tokenAmountRaw - alreadyFilled;
  if (fill <= 0n || fill > remaining) return { ok: false, code: "FILL_TOO_LARGE" };
  if (!order.allowPartialFill) return fill === remaining ? { ok: true } : { ok: false, code: "FILL_TOO_SMALL" };
  // The final remainder may be smaller than the minimum.
  if (fill < order.minimumFillAmountRaw && fill !== remaining) return { ok: false, code: "FILL_TOO_SMALL" };
  return { ok: true };
}

export interface SettlementAmounts {
  grossQuote: bigint;
  totalFee: bigint;
  platformFee: bigint;
  referralFee: bigint;
  buyerPays: bigint;
  sellerReceives: bigint;
  feeBps: number;
  feeMode: FeeMode;
}

/**
 * Fee arithmetic (integer lamports, floor rounding — never in the platform's favour):
 *   totalFee = floor(gross × bps / 10 000)
 *   SELLER_PAYS: buyer pays gross,                  seller receives gross − fee
 *   BUYER_PAYS:  buyer pays gross + fee,            seller receives gross
 *   SPLIT:       buyer pays gross + floor(fee / 2), seller receives gross − ceil(fee / 2)
 *   referralFee  = floor(totalFee × referralShareBps / 10 000) (only with a referrer)
 *   platformFee  = totalFee − referralFee
 * Invariant: buyerPays == sellerReceives + platformFee + referralFee.
 */
export function computeSettlementAmounts(args: {
  grossQuote: bigint;
  feeBps: number;
  feeMode: FeeMode;
  referralShareBps: number;
  hasReferrer: boolean;
}): SettlementAmounts {
  const totalFee = bpsOf(args.grossQuote, args.feeBps);
  let buyerPays: bigint;
  let sellerReceives: bigint;
  switch (args.feeMode) {
    case "SELLER_PAYS":
      buyerPays = args.grossQuote;
      sellerReceives = args.grossQuote - totalFee;
      break;
    case "BUYER_PAYS":
      buyerPays = args.grossQuote + totalFee;
      sellerReceives = args.grossQuote;
      break;
    case "SPLIT": {
      const buyerPart = totalFee / 2n;
      buyerPays = args.grossQuote + buyerPart;
      sellerReceives = args.grossQuote - (totalFee - buyerPart);
      break;
    }
  }
  const referralFee = args.hasReferrer ? mulDivFloor(totalFee, BigInt(args.referralShareBps), BPS_DENOMINATOR) : 0n;
  const platformFee = totalFee - referralFee;
  if (buyerPays !== sellerReceives + platformFee + referralFee) throw new Error("fee invariant violated");
  return { grossQuote: args.grossQuote, totalFee, platformFee, referralFee, buyerPays, sellerReceives, feeBps: args.feeBps, feeMode: args.feeMode };
}

/** The fee actually charged: never more than what the maker signed, and never more than current config. */
export function effectiveFeeBps(signedBps: number, currentConfigBps: number): number {
  return Math.min(signedBps, currentConfigBps);
}

/** SOL per whole token for an order. */
export function orderUnitPrice(quoteAmountRaw: bigint, tokenAmountRaw: bigint, tokenDecimals: number): Dec {
  return unitPrice(quoteAmountRaw, SOL_DECIMALS, tokenAmountRaw, tokenDecimals);
}

export function premiumVsMarket(otcPrice: Dec, marketPrice: Dec | null): Dec | null {
  if (!marketPrice || marketPrice.isZero()) return null;
  return premiumDiscountPct(otcPrice, marketPrice);
}
