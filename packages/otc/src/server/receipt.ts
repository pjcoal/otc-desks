import { D, SOL_DECIMALS, unitPrice } from "@app/shared";
import { big } from "@app/database";
import { sha256Hex } from "@app/solana";
import type { ReceiptView } from "../dto";
import { decodeSettlementMessage, SettlementVerificationError } from "../settlement-tx";
import type { OtcContext } from "./context";
import { tokenRef } from "./views";

const MEMO_RE = /^otc-settlement:v1:([0-9a-f]{64}):([A-Za-z0-9_]+)$/;

/**
 * Build a settlement receipt from the CHAIN. The database is consulted only to (a) find the agreed
 * message hash and (b) label the token; every amount shown comes from the decoded on-chain message
 * and the transaction's own balance changes.
 */
export async function verifyReceipt(ctx: OtcContext, signature: string): Promise<ReceiptView> {
  const empty: ReceiptView = {
    signature,
    verified: false,
    verificationErrors: [],
    status: "not_found",
    slot: null,
    blockTime: null,
    token: null,
    seller: null,
    buyer: null,
    tokenAmountRaw: null,
    netTokenReceivedRaw: null,
    sellerReceivedLamports: null,
    buyerPaidLamports: null,
    platformFeeLamports: null,
    referralFeeLamports: null,
    priceSolPerToken: null,
    refPriceSolPerToken: null,
    premiumDiscountPct: null,
    orderHash: null,
    memo: null,
    messageHashMatches: null,
  };
  const tx = await ctx.chain.getTransaction(signature);
  if (!tx) return empty;
  const state = await ctx.chain.getSignatureState(signature);
  const errors: string[] = [];
  const bytes = tx.transaction.message.serialize();
  const landedHash = sha256Hex(bytes);
  const row = await ctx.db.otcSettlement.findFirst({ where: { txSignature: signature } });

  let decoded: ReturnType<typeof decodeSettlementMessage> | null = null;
  try {
    decoded = decodeSettlementMessage(bytes);
  } catch (e) {
    errors.push(e instanceof SettlementVerificationError ? e.problems.join("; ") : "Not an OTC settlement transaction");
  }
  if (tx.meta?.err) errors.push(`Transaction failed on chain: ${JSON.stringify(tx.meta.err)}`);
  const messageHashMatches = row ? row.messageHash === landedHash : null;
  if (!row) errors.push("This transaction was not built by this platform's settlement flow; its amounts are shown as decoded but no agreed terms exist to verify against.");
  else if (!messageHashMatches) errors.push("On-chain message differs from the agreed settlement");

  const base: ReceiptView = {
    ...empty,
    status: tx.meta?.err ? "failed" : state.state === "finalized" ? "finalized" : "confirmed",
    slot: tx.slot,
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    messageHashMatches,
  };
  if (!decoded) return { ...base, verificationErrors: errors };

  const seller = decoded.signers[1]!;
  const buyer = decoded.feePayer;
  const memoMatch = decoded.memo ? MEMO_RE.exec(decoded.memo) : null;
  const orderHash = memoMatch?.[1] ?? null;
  if (!orderHash) errors.push("Memo does not bind an order hash");
  const order = orderHash ? await ctx.db.otcOrder.findUnique({ where: { orderHash }, include: { token: true } }) : null;
  const toSeller = decoded.solTransfers.filter((t) => t.to === seller).reduce((a, t) => a + t.lamports, 0n);
  const buyerPaid = decoded.solTransfers.reduce((a, t) => a + t.lamports, 0n);
  const toTreasury = row?.treasuryWallet ? decoded.solTransfers.filter((t) => t.to === row.treasuryWallet).reduce((a, t) => a + t.lamports, 0n) : null;
  const toReferrer = row?.referrerWallet ? decoded.solTransfers.filter((t) => t.to === row.referrerWallet).reduce((a, t) => a + t.lamports, 0n) : 0n;

  // Net tokens the buyer actually received, from the transaction's own token balance changes.
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? null });
  const destIndex = Array.from({ length: keys.length }, (_, i) => i).find((i) => keys.get(i)?.toBase58() === decoded!.tokenTransfer.destination);
  const pre = tx.meta?.preTokenBalances?.find((b) => b.accountIndex === destIndex)?.uiTokenAmount.amount ?? "0";
  const post = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === destIndex)?.uiTokenAmount.amount;
  const net = post !== undefined ? BigInt(post) - BigInt(pre) : null;

  const decimals = decoded.tokenTransfer.decimals;
  const price = decoded.tokenTransfer.amount > 0n ? unitPrice(buyerPaid - (toReferrer ?? 0n) - (toTreasury ?? 0n) + (order?.feeMode === "SELLER_PAYS" ? (toTreasury ?? 0n) + (toReferrer ?? 0n) : 0n), SOL_DECIMALS, decoded.tokenTransfer.amount, decimals) : null;
  const ref = row?.refPriceSolPerToken ? new D(row.refPriceSolPerToken.toFixed()) : null;
  const premium = price && ref && !ref.isZero() ? price.sub(ref).div(ref).mul(100).toFixed(2) : null;

  return {
    ...base,
    verified: errors.length === 0 && state.state !== "not_found",
    verificationErrors: errors,
    token: tokenRef(order?.token ?? null, decoded.tokenTransfer.mint, decimals),
    seller,
    buyer,
    tokenAmountRaw: decoded.tokenTransfer.amount.toString(),
    netTokenReceivedRaw: net?.toString() ?? null,
    sellerReceivedLamports: toSeller.toString(),
    buyerPaidLamports: buyerPaid.toString(),
    platformFeeLamports: toTreasury?.toString() ?? (row ? big(row.platformFeeLamports).toString() : null),
    referralFeeLamports: toReferrer.toString(),
    priceSolPerToken: price?.toFixed() ?? null,
    refPriceSolPerToken: ref?.toFixed() ?? null,
    premiumDiscountPct: premium,
    orderHash,
    memo: decoded.memo,
  };
}
