import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { type MessageV0, PublicKey, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { AppError, type ErrorCode } from "@app/shared";
import { logger } from "@app/shared/server";
import { big, dec, Prisma, type OtcOrder, type OtcSettlement, type Tx } from "@app/database";
import { verifyWalletSignature } from "@app/auth";
import { decodeTransactionError, estimateNetworkFeeLamports, fromBase64, inspectTokenAccountInfo, sha256Hex, transferFeeFor } from "@app/solana";
import { computeSettlementAmounts, effectiveFeeBps, quoteForFill } from "../amounts";
import { buildOrderMessage } from "../messages";
import { compileSettlementMessage, termsFromJson, termsToJson, verifySettlementMessage, type SettlementTerms, type SettlementTermsJson } from "../settlement-tx";
import { LIVE_SETTLEMENT_STATUSES, type OrderStatus, type SettlementStatus } from "../state";
import { audit, conflictFor, transitionOrder } from "./audit";
import { ACCEPT_HOLD_SECONDS, BLOCKHASH_SAFETY_MARGIN, SETTLEMENT_MIN_REMAINING_SECONDS, type OtcContext } from "./context";
import { notify, publishNotifications, type NotifyInput } from "./notify";
import { payloadOf, settlementView } from "./views";

const SETTLEMENT_COMPUTE_UNITS = 80_000;
/** Token-2022 ATA size with the ImmutableOwner extension (+ room for TransferFeeAmount). */
const ATA_SPACE_TOKEN_2022 = 182;
const ATA_SPACE_SPL = 165;

function verifyOrFail(bytes: Uint8Array, terms: SettlementTerms) {
  try {
    return verifySettlementMessage(bytes, terms);
  } catch (e) {
    logger.error({ err: e }, "settlement verification failed");
    throw new AppError("TX_VERIFICATION_FAILED", e instanceof Error ? e.message : undefined);
  }
}

/** Stored terms, re-verified against the stored message bytes on every read. */
function storedTerms(s: OtcSettlement): SettlementTermsJson {
  const json = s.terms as unknown as SettlementTermsJson;
  verifyOrFail(s.messageBytes, termsFromJson(json));
  return json;
}

export async function settlementViewFor(ctx: OtcContext, s: OtcSettlement) {
  return settlementView(s, storedTerms(s), ctx.config.PRIORITY_FEE_MICROLAMPORTS);
}

async function referrerFor(ctx: OtcContext, wallet: string): Promise<string | null> {
  if (ctx.config.OTC_REFERRAL_SHARE_BPS === 0) return null;
  const a = await ctx.db.referralAttribution.findUnique({ where: { wallet } });
  return a && a.referrerWallet !== wallet ? a.referrerWallet : null;
}

function parties(order: OtcOrder, acceptor: string) {
  return order.side === "SELL" ? { seller: order.makerWallet, buyer: acceptor } : { seller: acceptor, buyer: order.makerWallet };
}

function fail(code: ErrorCode, message?: string, details?: unknown): never {
  throw new AppError(code, message, details);
}

/**
 * POST /api/otc/settlement/prepare
 * Validates everything immediately before building, builds the deterministic settlement message,
 * self-verifies it, simulates it, and persists it under a unique per-order lock.
 * Idempotent: returns the live settlement while its blockhash is still usable.
 */
export async function prepareSettlement(ctx: OtcContext, orderId: string, viewer: string) {
  const order = await ctx.db.otcOrder.findUnique({ where: { id: orderId } });
  if (!order) fail("NOT_FOUND", "Order not found.");
  const acceptance = order.activeAcceptanceId ? await ctx.db.otcOrderSignature.findUnique({ where: { id: order.activeAcceptanceId } }) : null;
  if (!acceptance || acceptance.kind !== "ACCEPT") fail("SETTLEMENT_NOT_READY", "This order has no active acceptance.");
  if (viewer !== order.makerWallet && viewer !== acceptance.signer) fail("FORBIDDEN");

  const status = order.status as OrderStatus;
  if (status !== "ACCEPTED" && status !== "SETTLEMENT_READY") throw conflictFor(status);

  // Re-use a live settlement if its blockhash is still good; otherwise retire it safely.
  const live = await ctx.db.otcSettlement.findFirst({ where: { orderId, activeLock: orderId } });
  if (live) {
    const height = await ctx.chain.getBlockHeight();
    if (height <= Number(live.lastValidBlockHeight) - BLOCKHASH_SAFETY_MARGIN && LIVE_SETTLEMENT_STATUSES.has(live.status as SettlementStatus)) {
      return settlementViewFor(ctx, live);
    }
    await reconcileSettlement(ctx, live.id);
    const after = await ctx.db.otcSettlement.findUnique({ where: { id: live.id } });
    if (after?.activeLock) fail("SETTLEMENT_IN_PROGRESS", "The previous settlement transaction is still valid on chain. Try again in a minute.");
  }

  const fresh = await ctx.db.otcOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (fresh.status !== "ACCEPTED" && fresh.status !== "SETTLEMENT_READY") throw conflictFor(fresh.status as OrderStatus);
  if (fresh.expiresAt.getTime() - ctx.now().getTime() < SETTLEMENT_MIN_REMAINING_SECONDS * 1000) {
    fail("ORDER_EXPIRED", "This offer expires too soon to settle safely.");
  }

  // Defence in depth: re-verify both signatures over the exact stored payloads.
  const payload = { ...payloadOf(fresh), parentOrderHash: fresh.parentOrderId ? (await ctx.db.otcOrder.findUnique({ where: { id: fresh.parentOrderId }, select: { orderHash: true } }))?.orderHash ?? null : null };
  if (!verifyWalletSignature(buildOrderMessage(payload), fresh.signature, fresh.makerWallet)) fail("SIGNATURE_INVALID", "Stored order signature failed verification.");
  if (!verifyWalletSignature(acceptance.message, acceptance.signature, acceptance.signer)) fail("SIGNATURE_INVALID", "Stored acceptance signature failed verification.");

  const fill = big(acceptance.fillAmountRaw);
  const filled = big(fresh.filledAmountRaw);
  const gross = quoteForFill({ side: fresh.side, tokenAmountRaw: big(fresh.tokenAmountRaw), quoteAmountRaw: big(fresh.quoteAmountRaw) }, filled, fill);
  const { seller, buyer } = parties(fresh, acceptance.signer);

  // ── Token checks ──
  const mint = await ctx.chain.getMint(fresh.tokenMint, { allowFreezeAuthority: ctx.config.OTC_ALLOW_FREEZE_AUTHORITY });
  if (!mint) fail("NOT_FOUND", "Token mint not found.");
  if (mint.programId.toBase58() !== fresh.tokenProgram) fail("TOKEN_PROGRAM_MISMATCH");
  if (mint.decimals !== fresh.tokenDecimals) fail("TOKEN_PROGRAM_MISMATCH", "Token decimals changed since the order was signed.");
  if (!mint.safety.ok) fail("TOKEN_UNSUPPORTED_EXTENSION", mint.safety.blockers.join(" "), { blockers: mint.safety.blockers });
  const transferFee = transferFeeFor(mint.transferFee, fill);
  const useFeeIx = mint.program === "token-2022" && mint.transferFee !== null && mint.transferFee.basisPoints > 0;

  // ── Fees & referral ──
  const feeBps = effectiveFeeBps(fresh.platformFeeBps, ctx.config.OTC_PLATFORM_FEE_BPS);
  const feePayingSide = fresh.feeMode === "BUYER_PAYS" ? buyer : seller;
  let referrer = await referrerFor(ctx, feePayingSide);
  if (referrer === seller || referrer === buyer) referrer = null;
  const programKey = mint.programId;
  const mintKey = new PublicKey(fresh.tokenMint);
  const sellerAta = getAssociatedTokenAddressSync(mintKey, new PublicKey(seller), false, programKey);
  const buyerAta = getAssociatedTokenAddressSync(mintKey, new PublicKey(buyer), false, programKey);
  const treasury = ctx.config.PLATFORM_TREASURY_WALLET ?? null;

  const [sellerAtaInfo, buyerAtaInfo, sellerInfo, buyerInfo, treasuryInfo, referrerInfo] = await ctx.chain.getAccounts([
    sellerAta.toBase58(),
    buyerAta.toBase58(),
    seller,
    buyer,
    treasury ?? buyer,
    referrer ?? buyer,
  ]);
  const rentMin = await ctx.chain.getRentExemptMinimum(0);
  if (referrer && BigInt(referrerInfo?.lamports ?? 0) === 0n) referrer = null; // unfunded referrer: fee stays with the platform

  const amounts = computeSettlementAmounts({ grossQuote: gross, feeBps, feeMode: fresh.feeMode, referralShareBps: ctx.config.OTC_REFERRAL_SHARE_BPS, hasReferrer: referrer !== null });
  if (amounts.platformFee > 0n && !treasury) fail("INTERNAL", "Platform treasury wallet is not configured.");
  if (amounts.platformFee > 0n && BigInt(treasuryInfo?.lamports ?? 0) === 0n && amounts.platformFee < rentMin) {
    fail("INTERNAL", "Platform treasury account is not initialised (fund it with the rent-exempt minimum).");
  }

  // ── Seller checks ──
  const sellerAcc = inspectTokenAccountInfo(sellerAta, sellerAtaInfo ?? null);
  if (!sellerAcc.exists || sellerAcc.owner !== seller || sellerAcc.mint !== fresh.tokenMint) fail("SELLER_INSUFFICIENT_TOKENS", "Seller has no token account for this mint.");
  if (sellerAcc.frozen) fail("SELLER_ACCOUNT_FROZEN");
  if (sellerAcc.amount < fill) fail("SELLER_INSUFFICIENT_TOKENS");
  const sellerLamports = BigInt(sellerInfo?.lamports ?? 0);
  if (sellerLamports === 0n && amounts.sellerReceives < rentMin) fail("SELLER_CANNOT_RECEIVE");

  // ── Buyer checks ──
  const buyerAcc = inspectTokenAccountInfo(buyerAta, buyerAtaInfo ?? null);
  if (buyerAcc.exists && buyerAcc.frozen) fail("SELLER_ACCOUNT_FROZEN", "The buyer's token account is frozen.");
  const ataRent = buyerAcc.exists ? 0n : await ctx.chain.getRentExemptMinimum(mint.program === "token-2022" ? ATA_SPACE_TOKEN_2022 : ATA_SPACE_SPL);
  const networkFee = estimateNetworkFeeLamports(2, SETTLEMENT_COMPUTE_UNITS, ctx.config.PRIORITY_FEE_MICROLAMPORTS);
  const buyerNeeds = amounts.buyerPays + networkFee + ataRent + rentMin;
  if (BigInt(buyerInfo?.lamports ?? 0) < buyerNeeds) fail("BUYER_INSUFFICIENT_SOL", undefined, { requiredLamports: buyerNeeds.toString() });

  // ── Build, self-verify, simulate ──
  const attempt = (await ctx.db.otcSettlement.count({ where: { orderId } })) + 1;
  const settlementId = `stl_${fresh.id.slice(0, 12)}_${attempt}`;
  const terms: SettlementTerms = {
    settlementId,
    orderHash: fresh.orderHash,
    seller,
    buyer,
    tokenMint: fresh.tokenMint,
    tokenProgram: fresh.tokenProgram,
    tokenDecimals: fresh.tokenDecimals,
    tokenAmountRaw: fill,
    transferFeeRaw: useFeeIx ? transferFee : null,
    sellerReceivesLamports: amounts.sellerReceives,
    platformFeeLamports: amounts.platformFee,
    treasuryWallet: amounts.platformFee > 0n ? treasury : null,
    referralFeeLamports: amounts.referralFee,
    referrerWallet: amounts.referralFee > 0n ? referrer : null,
    computeUnitLimit: SETTLEMENT_COMPUTE_UNITS,
    computeUnitPriceMicroLamports: ctx.config.PRIORITY_FEE_MICROLAMPORTS,
  };
  const { blockhash, lastValidBlockHeight } = await ctx.chain.getLatestBlockhash();
  const built = compileSettlementMessage(terms, blockhash, lastValidBlockHeight);
  verifyOrFail(built.bytes, terms);

  if (ctx.config.SIMULATE_TRANSACTIONS) {
    const sim = await ctx.chain.simulate(new VersionedTransaction(built.message));
    const decoded = decodeTransactionError(sim.err, sim.logs, {
      instructionPrograms: built.message.compiledInstructions.map((c) => built.message.staticAccountKeys[c.programIdIndex]!),
      tokenInsufficientFunds: "SELLER_INSUFFICIENT_TOKENS",
      systemInsufficientFunds: "BUYER_INSUFFICIENT_SOL",
    });
    if (decoded) fail(decoded.code, decoded.message, { logs: sim.logs?.slice(-12) });
  }

  // ── Persist under the per-order lock ──
  const ref = await ctx.market.referencePrice(fresh.tokenMint).catch(() => null);
  const created = await ctx.db
    .$transaction(async (tx) => {
      const s = await tx.otcSettlement.create({
        data: {
          id: settlementId,
          orderId,
          activeLock: orderId,
          attempt,
          acceptanceSignatureId: acceptance.id,
          sellerWallet: seller,
          buyerWallet: buyer,
          tokenMint: fresh.tokenMint,
          tokenProgram: fresh.tokenProgram,
          tokenDecimals: fresh.tokenDecimals,
          tokenAmountRaw: dec(fill),
          grossQuoteLamports: dec(gross),
          buyerPaysLamports: dec(amounts.buyerPays),
          sellerReceivesLamports: dec(amounts.sellerReceives),
          platformFeeLamports: dec(amounts.platformFee),
          referralFeeLamports: dec(amounts.referralFee),
          referrerWallet: terms.referrerWallet,
          treasuryWallet: terms.treasuryWallet,
          transferFeeRaw: dec(transferFee),
          netTokenReceivedRaw: dec(fill - transferFee),
          messageBytes: Buffer.from(built.bytes),
          terms: termsToJson(terms),
          messageHash: built.hash,
          blockhash,
          lastValidBlockHeight: BigInt(lastValidBlockHeight),
          status: "AWAITING_BUYER_SIGNATURE",
          refPriceSolPerToken: ref ? new Prisma.Decimal(ref.priceSolPerToken) : null,
          refPriceAt: ref?.at ?? null,
        },
      });
      await transitionOrder(tx, { orderId, to: "SETTLEMENT_READY", from: ["ACCEPTED", "SETTLEMENT_READY"], actor: viewer, reason: `Settlement ${settlementId} built`, data: { messageHash: built.hash, attempt } });
      await audit(tx, { actor: viewer, action: "settlement.prepared", entityType: "OtcSettlement", entityId: s.id, toStatus: s.status, data: { messageHash: built.hash, blockhash, lastValidBlockHeight, amounts } });
      return s;
    })
    .catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") fail("SETTLEMENT_IN_PROGRESS");
      throw e;
    });
  return settlementView(created, termsToJson(terms), ctx.config.PRIORITY_FEE_MICROLAMPORTS);
}

/**
 * POST /api/otc/settlement/partial-signature
 * Accepts a wallet-signed copy of the settlement transaction. The message bytes must equal the
 * stored bytes exactly (otherwise TX_CHANGED). Only the signer's signature is extracted and
 * verified; the backend never re-serialises or edits the message. Buyer signs first.
 */
export async function submitPartialSignature(ctx: OtcContext, settlementId: string, input: { signedTransactionBase64: string; viewer: string }) {
  const s = await ctx.db.otcSettlement.findUnique({ where: { id: settlementId } });
  if (!s) fail("NOT_FOUND", "Settlement not found.");
  const role = input.viewer === s.buyerWallet ? "buyer" : input.viewer === s.sellerWallet ? "seller" : null;
  if (!role) fail("FORBIDDEN");
  const expected: SettlementStatus = role === "buyer" ? "AWAITING_BUYER_SIGNATURE" : "AWAITING_SELLER_SIGNATURE";
  if (s.status !== expected) {
    if (s.status === "EXPIRED") fail("BLOCKHASH_EXPIRED");
    fail("SETTLEMENT_NOT_READY", role === "seller" && s.status === "AWAITING_BUYER_SIGNATURE" ? "The buyer signs first. You'll be notified when it's your turn." : undefined);
  }

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(fromBase64(input.signedTransactionBase64));
  } catch {
    fail("VALIDATION", "Could not decode the signed transaction.");
  }
  const bytes = tx.message.serialize();
  if (sha256Hex(bytes) !== s.messageHash) fail("TX_CHANGED");
  const index = role === "buyer" ? 0 : 1;
  const sigBytes = tx.signatures[index];
  if (!sigBytes || sigBytes.every((b) => b === 0)) fail("SIGNATURE_INVALID", "The wallet did not sign the transaction.");
  const signature = bs58.encode(sigBytes);
  if (!verifyWalletSignature(s.messageBytes, signature, input.viewer)) fail("SIGNATURE_INVALID");

  // Order must still be live: cancellation / expiry / fill are re-checked at every step.
  const order = await ctx.db.otcOrder.findUniqueOrThrow({ where: { id: s.orderId } });
  if (order.status !== "SETTLEMENT_READY") throw conflictFor(order.status as OrderStatus);
  if (order.expiresAt.getTime() <= ctx.now().getTime()) fail("ORDER_EXPIRED");
  const height = await ctx.chain.getBlockHeight();
  if (height > Number(s.lastValidBlockHeight) - BLOCKHASH_SAFETY_MARGIN) {
    await expireSettlement(ctx, s, "Blockhash expired before all signatures were collected");
    fail("BLOCKHASH_EXPIRED");
  }

  let pending: NotifyInput[] = [];
  const next: SettlementStatus = role === "buyer" ? "AWAITING_SELLER_SIGNATURE" : "READY_TO_SUBMIT";
  await ctx.db.$transaction(async (dbtx) => {
    const res = await dbtx.otcSettlement.updateMany({
      where: { id: s.id, status: expected, activeLock: s.orderId },
      data: role === "buyer" ? { buyerSignature: signature, txSignature: signature, status: next } : { sellerSignature: signature, status: next },
    });
    if (res.count !== 1) fail("SETTLEMENT_NOT_READY", "The settlement changed concurrently. Please refresh.");
    await audit(dbtx, { actor: input.viewer, action: `settlement.signed.${role}`, entityType: "OtcSettlement", entityId: s.id, fromStatus: expected, toStatus: next, data: { messageHash: s.messageHash } });
    if (role === "buyer") {
      pending = await notify(dbtx, [{ wallet: s.sellerWallet, type: "SIGNATURE_REQUIRED", title: "Your signature is required", body: "The buyer signed the settlement. Review and sign to complete the trade.", link: `/deal/${order.publicId}`, orderId: order.id }]);
    }
  });
  await publishNotifications(ctx.kv, pending);
  if (role === "seller") return submitSettlement(ctx, s.id, input.viewer);
  return settlementViewFor(ctx, await ctx.db.otcSettlement.findUniqueOrThrow({ where: { id: s.id } }));
}

/** POST /api/otc/settlement/submit — broadcast the fully co-signed transaction (idempotent). */
export async function submitSettlement(ctx: OtcContext, settlementId: string, viewer: string) {
  const s = await ctx.db.otcSettlement.findUnique({ where: { id: settlementId } });
  if (!s) fail("NOT_FOUND", "Settlement not found.");
  if (viewer !== s.buyerWallet && viewer !== s.sellerWallet) fail("FORBIDDEN");
  if (s.status === "SUBMITTED" || s.status === "CONFIRMED" || s.status === "FINALIZED") return reconcileAndView(ctx, s.id);
  if (s.status !== "READY_TO_SUBMIT" || !s.buyerSignature || !s.sellerSignature) fail("SETTLEMENT_NOT_READY");

  const order = await ctx.db.otcOrder.findUniqueOrThrow({ where: { id: s.orderId } });
  if (order.status !== "SETTLEMENT_READY") {
    await ctx.db.otcSettlement.updateMany({ where: { id: s.id, status: "READY_TO_SUBMIT" }, data: { status: "FAILED", failureReason: `Order is ${order.status}`, activeLock: null } });
    throw conflictFor(order.status as OrderStatus);
  }
  // Both signatures re-verified over the stored bytes; the transaction is assembled from those bytes.
  if (!verifyWalletSignature(s.messageBytes, s.buyerSignature, s.buyerWallet) || !verifyWalletSignature(s.messageBytes, s.sellerSignature, s.sellerWallet)) {
    fail("SIGNATURE_INVALID");
  }
  const message = VersionedMessage.deserialize(s.messageBytes);
  const tx = new VersionedTransaction(message, [bs58.decode(s.buyerSignature), bs58.decode(s.sellerSignature)]);

  const claimed = await ctx.db.otcSettlement.updateMany({ where: { id: s.id, status: "READY_TO_SUBMIT" }, data: { status: "SUBMITTED" } });
  if (claimed.count !== 1) return reconcileAndView(ctx, s.id);
  try {
    await ctx.chain.send(tx.serialize());
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs ?? null;
    const raw = (e as { transactionError?: unknown }).transactionError;
    logger.warn({ err: e instanceof Error ? e.message : e, settlementId }, "settlement broadcast failed");
    // Preflight rejection means it never reached the ledger; mark failed and release the order.
    const decoded = decodeTransactionError((raw as never) ?? "SimulationFailed", logs, {
      instructionPrograms: (message as MessageV0).compiledInstructions.map((c) => (message as MessageV0).staticAccountKeys[c.programIdIndex]!),
      tokenInsufficientFunds: "SELLER_INSUFFICIENT_TOKENS",
      systemInsufficientFunds: "BUYER_INSUFFICIENT_SOL",
    });
    const state = await ctx.chain.getSignatureState(s.txSignature!).catch(() => ({ state: "not_found" as const }));
    if (state.state === "not_found") {
      await failSettlement(ctx, s.id, decoded?.message ?? "Broadcast rejected", true);
      fail(decoded?.code ?? "SIMULATION_FAILED", decoded?.message);
    }
  }
  await ctx.db.transactionRecord.upsert({
    where: { signature: s.txSignature! },
    create: { signature: s.txSignature!, kind: "OTC_SETTLEMENT", wallet: s.buyerWallet, mint: s.tokenMint, status: "SUBMITTED", summary: { settlementId: s.id, orderId: s.orderId } },
    update: { status: "SUBMITTED" },
  });
  const pending = [s.buyerWallet, s.sellerWallet].map((w) => ({ wallet: w, type: "TX_SUBMITTED" as const, title: "Settlement submitted", body: "Waiting for confirmation on Solana.", link: `/trade/${s.txSignature}`, orderId: s.orderId }));
  await ctx.db.$transaction((dbtx) => notify(dbtx, pending));
  await publishNotifications(ctx.kv, pending);
  await audit(ctx.db, { actor: viewer, action: "settlement.submitted", entityType: "OtcSettlement", entityId: s.id, fromStatus: "READY_TO_SUBMIT", toStatus: "SUBMITTED", data: { txSignature: s.txSignature } });
  return reconcileAndView(ctx, s.id);
}

async function reconcileAndView(ctx: OtcContext, id: string) {
  await reconcileSettlement(ctx, id);
  return settlementViewFor(ctx, await ctx.db.otcSettlement.findUniqueOrThrow({ where: { id } }));
}

async function expireSettlement(ctx: OtcContext, s: OtcSettlement, reason: string) {
  await ctx.db.$transaction(async (tx) => {
    const res = await tx.otcSettlement.updateMany({ where: { id: s.id, activeLock: s.orderId, status: { in: ["AWAITING_BUYER_SIGNATURE", "AWAITING_SELLER_SIGNATURE", "READY_TO_SUBMIT", "SUBMITTED"] } }, data: { status: "EXPIRED", failureReason: reason, activeLock: null } });
    if (res.count !== 1) return;
    await audit(tx, { actor: "system", action: "settlement.expired", entityType: "OtcSettlement", entityId: s.id, toStatus: "EXPIRED", data: { reason } });
    await releaseOrder(ctx, tx, s.orderId, reason);
  });
}

async function failSettlement(ctx: OtcContext, id: string, reason: string, release: boolean) {
  await ctx.db.$transaction(async (tx) => {
    const s = await tx.otcSettlement.findUniqueOrThrow({ where: { id } });
    const res = await tx.otcSettlement.updateMany({ where: { id, status: { in: ["AWAITING_BUYER_SIGNATURE", "AWAITING_SELLER_SIGNATURE", "READY_TO_SUBMIT", "SUBMITTED"] } }, data: { status: "FAILED", failureReason: reason, activeLock: null } });
    if (res.count !== 1) return;
    await audit(tx, { actor: "system", action: "settlement.failed", entityType: "OtcSettlement", entityId: id, toStatus: "FAILED", data: { reason } });
    const pending = await notify(tx, [s.buyerWallet, s.sellerWallet].map((w) => ({ wallet: w, type: "SETTLEMENT_FAILED" as const, title: "Settlement failed", body: reason, orderId: s.orderId })));
    void pending;
    if (release) await releaseOrder(ctx, tx, s.orderId, reason);
  });
}

/** After an expired/failed settlement: back to ACCEPTED while the hold lasts, else to OPEN / PARTIALLY_FILLED. */
async function releaseOrder(ctx: OtcContext, tx: Tx, orderId: string, reason: string) {
  const order = await tx.otcOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "SETTLEMENT_READY") return;
  const holdActive = order.acceptanceExpiresAt && order.acceptanceExpiresAt.getTime() > ctx.now().getTime();
  const to: OrderStatus = holdActive ? "ACCEPTED" : big(order.filledAmountRaw) > 0n ? "PARTIALLY_FILLED" : "OPEN";
  await transitionOrder(tx, {
    orderId,
    to,
    from: ["SETTLEMENT_READY"],
    actor: "system",
    reason,
    ...(to === "ACCEPTED" ? {} : { extra: { activeAcceptanceId: null, acceptanceExpiresAt: null } }),
  });
}

/**
 * Reconcile a settlement with the chain. Safe to call repeatedly and concurrently. Never trusts the
 * database for economics: a confirmed transaction is accepted only if its message hash equals the
 * stored, agreed message hash and it executed without error.
 */
export async function reconcileSettlement(ctx: OtcContext, settlementId: string): Promise<void> {
  const s = await ctx.db.otcSettlement.findUnique({ where: { id: settlementId } });
  if (!s || !LIVE_SETTLEMENT_STATUSES.has(s.status as SettlementStatus)) {
    if (s && s.status === "CONFIRMED") await maybeFinalize(ctx, s);
    return;
  }
  if (s.txSignature) {
    const st = await ctx.chain.getSignatureState(s.txSignature);
    if (st.state === "confirmed" || st.state === "finalized" || st.state === "processed") {
      if (st.state === "processed") return;
      const onChain = await ctx.chain.getTransaction(s.txSignature);
      if (!onChain) return;
      const landedHash = sha256Hex(onChain.transaction.message.serialize());
      if (landedHash !== s.messageHash) {
        logger.error({ settlementId, landedHash }, "on-chain transaction does not match the agreed message");
        await failSettlement(ctx, s.id, "On-chain transaction does not match the agreed settlement", false);
        return;
      }
      if (onChain.meta?.err) {
        const decoded = decodeTransactionError(onChain.meta.err, onChain.meta.logMessages ?? null, {
          instructionPrograms: onChain.transaction.message.compiledInstructions.map((c) => onChain.transaction.message.staticAccountKeys[c.programIdIndex]!),
          tokenInsufficientFunds: "SELLER_INSUFFICIENT_TOKENS",
          systemInsufficientFunds: "BUYER_INSUFFICIENT_SOL",
        });
        await failSettlement(ctx, s.id, decoded?.message ?? "Transaction failed on chain", true);
        return;
      }
      await markSettled(ctx, s, { slot: onChain.slot, blockTime: onChain.blockTime ?? null, finalized: st.state === "finalized" });
      return;
    }
    if (st.state === "failed") {
      await failSettlement(ctx, s.id, "Transaction failed on chain", true);
      return;
    }
  }
  // Not landed: only retire once the blockhash can no longer be valid.
  const height = await ctx.chain.getBlockHeight();
  if (height > Number(s.lastValidBlockHeight)) {
    if (s.txSignature) {
      const again = await ctx.chain.getSignatureState(s.txSignature);
      if (again.state !== "not_found") return reconcileSettlement(ctx, settlementId);
    }
    await expireSettlement(ctx, s, s.status === "SUBMITTED" ? "Transaction was not confirmed before its blockhash expired" : "Blockhash expired before all signatures were collected");
  }
}

async function maybeFinalize(ctx: OtcContext, s: OtcSettlement) {
  if (!s.txSignature) return;
  const st = await ctx.chain.getSignatureState(s.txSignature);
  if (st.state === "finalized") {
    await ctx.db.otcSettlement.updateMany({ where: { id: s.id, status: "CONFIRMED" }, data: { status: "FINALIZED" } });
    await ctx.db.transactionRecord.updateMany({ where: { signature: s.txSignature }, data: { status: "FINALIZED" } });
  }
}

async function markSettled(ctx: OtcContext, s: OtcSettlement, chain: { slot: number; blockTime: number | null; finalized: boolean }) {
  let pending: NotifyInput[] = [];
  await ctx.db.$transaction(async (tx) => {
    const res = await tx.otcSettlement.updateMany({
      where: { id: s.id, status: { in: ["AWAITING_BUYER_SIGNATURE", "AWAITING_SELLER_SIGNATURE", "READY_TO_SUBMIT", "SUBMITTED", "FAILED", "EXPIRED"] } },
      data: {
        status: chain.finalized ? "FINALIZED" : "CONFIRMED",
        activeLock: null,
        slot: BigInt(chain.slot),
        blockTime: chain.blockTime ? new Date(chain.blockTime * 1000) : null,
        verifiedAt: ctx.now(),
        failureReason: null,
      },
    });
    if (res.count !== 1) return; // already recorded by a concurrent reconciler
    const order = await tx.otcOrder.findUniqueOrThrow({ where: { id: s.orderId } });
    const filled = big(order.filledAmountRaw) + big(s.tokenAmountRaw);
    const total = big(order.tokenAmountRaw);
    const to: OrderStatus = filled >= total ? "FILLED" : "PARTIALLY_FILLED";
    const late = order.status === "CANCELLED" || order.status === "EXPIRED" || order.status === "INVALIDATED";
    await transitionOrder(tx, {
      orderId: order.id,
      to,
      actor: "system",
      chainProof: true,
      reason: late ? `Settled on chain (${s.txSignature}) from a transaction both parties signed before the order became ${order.status}` : `Settled on chain (${s.txSignature})`,
      extra: { filledAmountRaw: dec(filled), activeAcceptanceId: null, acceptanceExpiresAt: null, ...(to === "FILLED" ? { filledAt: ctx.now() } : {}) },
    });
    if (big(s.platformFeeLamports) > 0n && s.treasuryWallet) {
      await tx.platformFee.create({ data: { settlementId: s.id, amountLamports: s.platformFeeLamports, treasuryWallet: s.treasuryWallet, txSignature: s.txSignature! } });
    }
    if (big(s.referralFeeLamports) > 0n && s.referrerWallet) {
      await tx.referralPayout.create({ data: { settlementId: s.id, referrerWallet: s.referrerWallet, amountLamports: s.referralFeeLamports, txSignature: s.txSignature! } });
    }
    if (order.rootNegotiationId) {
      await tx.otcNegotiation.update({ where: { id: order.rootNegotiationId }, data: { status: "SETTLED" } });
      // Superseded revisions in this thread can no longer be accepted.
      const superseded = await tx.otcOrder.findMany({ where: { rootNegotiationId: order.rootNegotiationId, id: { not: order.id }, status: { in: ["OPEN", "NEGOTIATING"] } }, select: { id: true } });
      for (const o of superseded) await transitionOrder(tx, { orderId: o.id, to: "INVALIDATED", actor: "system", reason: "Negotiation settled" });
      // A non-partial public root owned by a party to this trade is superseded by the negotiated deal.
      if (order.rootOrderId !== order.id) {
        const root = await tx.otcOrder.findUnique({ where: { id: order.rootOrderId } });
        if (root && root.takerWallet === null && !root.allowPartialFill && (root.status === "OPEN" || root.status === "NEGOTIATING") && [s.sellerWallet, s.buyerWallet].includes(root.makerWallet)) {
          await transitionOrder(tx, { orderId: root.id, to: "INVALIDATED", actor: "system", reason: "Superseded by a negotiated settlement" });
        }
      }
    }
    await tx.transactionRecord.upsert({
      where: { signature: s.txSignature! },
      create: { signature: s.txSignature!, kind: "OTC_SETTLEMENT", wallet: s.buyerWallet, mint: s.tokenMint, status: chain.finalized ? "FINALIZED" : "CONFIRMED", slot: BigInt(chain.slot), summary: { settlementId: s.id, orderId: s.orderId } },
      update: { status: chain.finalized ? "FINALIZED" : "CONFIRMED", slot: BigInt(chain.slot) },
    });
    await audit(tx, { actor: "system", action: "settlement.confirmed", entityType: "OtcSettlement", entityId: s.id, toStatus: chain.finalized ? "FINALIZED" : "CONFIRMED", data: { txSignature: s.txSignature, slot: chain.slot } });
    pending = await notify(tx, [s.buyerWallet, s.sellerWallet].map((w) => ({ wallet: w, type: "TRADE_CONFIRMED" as const, title: "OTC trade confirmed", body: "Both legs settled atomically on Solana.", link: `/trade/${s.txSignature}`, orderId: s.orderId })));
  });
  await publishNotifications(ctx.kv, pending);
  await ctx.kv.publish(`otc:${s.tokenMint}`, JSON.stringify({ kind: "trade", settlementId: s.id })).catch(() => {});
}

export async function getSettlement(ctx: OtcContext, id: string, viewer: string) {
  const s = await ctx.db.otcSettlement.findUnique({ where: { id } });
  if (!s || (viewer !== s.buyerWallet && viewer !== s.sellerWallet)) fail("NOT_FOUND", "Settlement not found.");
  if (LIVE_SETTLEMENT_STATUSES.has(s.status as SettlementStatus) || s.status === "CONFIRMED") await reconcileSettlement(ctx, s.id);
  return settlementViewFor(ctx, await ctx.db.otcSettlement.findUniqueOrThrow({ where: { id } }));
}

/** Periodic maintenance (indexer worker): expire orders, release stale holds, reconcile live settlements. */
export async function runMaintenance(ctx: OtcContext): Promise<{ expired: number; released: number; reconciled: number }> {
  const now = ctx.now();
  let expired = 0;
  let released = 0;
  const due = await ctx.db.otcOrder.findMany({ where: { expiresAt: { lte: now }, status: { in: ["OPEN", "NEGOTIATING", "ACCEPTED", "PARTIALLY_FILLED"] } }, take: 500 });
  for (const o of due) {
    try {
      await ctx.db.$transaction(async (tx) => {
        await transitionOrder(tx, { orderId: o.id, to: "EXPIRED", actor: "system", reason: "Order expired", extra: { activeAcceptanceId: null, acceptanceExpiresAt: null } });
        const parties = [o.makerWallet, o.takerWallet].filter((w): w is string => !!w);
        await notify(tx, parties.map((w) => ({ wallet: w, type: "ORDER_EXPIRED" as const, title: "Order expired", body: "An OTC order reached its expiry.", link: `/deal/${o.publicId}`, orderId: o.id })));
      });
      expired++;
    } catch {
      // concurrently changed — next sweep re-evaluates
    }
  }
  const stale = await ctx.db.otcOrder.findMany({ where: { status: "ACCEPTED", acceptanceExpiresAt: { lte: now } }, take: 500 });
  for (const o of stale) {
    try {
      await ctx.db.$transaction(async (tx) => {
        const to: OrderStatus = big(o.filledAmountRaw) > 0n ? "PARTIALLY_FILLED" : "OPEN";
        await transitionOrder(tx, { orderId: o.id, to, from: ["ACCEPTED"], actor: "system", reason: `Acceptance hold of ${ACCEPT_HOLD_SECONDS / 60} minutes elapsed`, extra: { activeAcceptanceId: null, acceptanceExpiresAt: null } });
        if (o.rootNegotiationId) await tx.otcNegotiation.updateMany({ where: { id: o.rootNegotiationId, status: "AGREED" }, data: { status: "OPEN" } });
      });
      released++;
    } catch {
      // ignore
    }
  }
  const live = await ctx.db.otcSettlement.findMany({ where: { OR: [{ activeLock: { not: null } }, { status: "CONFIRMED" }] }, take: 200, select: { id: true } });
  for (const l of live) await reconcileSettlement(ctx, l.id).catch((e) => logger.warn({ err: e instanceof Error ? e.message : e, id: l.id }, "reconcile failed"));
  return { expired, released, reconciled: live.length };
}
