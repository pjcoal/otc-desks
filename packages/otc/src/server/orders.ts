import { AppError, decimalToDbString } from "@app/shared";
import { dec, Prisma, big, type OtcOrder } from "@app/database";
import { generatePublicId } from "@app/auth/server";
import { checkFill, orderUnitPrice, quoteForFill } from "../amounts";
import { hashPayload } from "../canonical";
import { buildAcceptMessage, buildCancelMessage } from "../messages";
import type { OrderPayload } from "../schema";
import { ACCEPTABLE_STATUSES, CANCELLABLE_STATUSES, TERMINAL_STATUSES, type OrderStatus } from "../state";
import { isFresh, verifyAccept, verifyCancel, verifyOrder, type VerifyResult } from "../verify";
import { audit, conflictFor, transitionOrder } from "./audit";
import { ACCEPT_HOLD_SECONDS, domainOf, nowSeconds, type OtcContext } from "./context";
import { notify, publishNotifications, type NotifyInput } from "./notify";
import { canView, negotiationView, orderView } from "./views";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { inspectTokenAccountInfo } from "@app/solana";

const CREATE_CLOCK_SKEW_SECONDS = 300;
/** Maximum orders a single wallet may hold in ACCEPTED / SETTLEMENT_READY at once. */
export const MAX_CONCURRENT_HOLDS = 3;

function mapVerify<T>(r: VerifyResult<T>): T {
  if (r.ok) return r.value;
  if (r.reason === "DOMAIN") throw new AppError("NETWORK_MISMATCH");
  if (r.reason === "SIGNATURE") throw new AppError("SIGNATURE_INVALID");
  throw new AppError("VALIDATION", r.detail ? `Invalid payload: ${r.detail}` : undefined);
}

function uniqueViolation(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const meta = JSON.stringify(e.meta ?? {});
    return meta + e.message;
  }
  return null;
}

const orderInclude = { token: true, parentOrder: { select: { orderHash: true } } } as const;

/** Shared validation for any newly signed order (root or counter). */
async function validateNewOrder(ctx: OtcContext, payload: OrderPayload, viewer: string) {
  if (payload.makerWallet !== viewer) throw new AppError("FORBIDDEN", "You can only publish orders signed by your connected wallet.");
  const now = nowSeconds(ctx);
  if (Math.abs(payload.createdAt - now) > CREATE_CLOCK_SKEW_SECONDS) throw new AppError("VALIDATION", "Order timestamp is too far from the current time. Check your device clock.");
  const ttl = payload.expiresAt - now;
  if (ttl < ctx.config.OTC_MIN_TTL_SECONDS) throw new AppError("VALIDATION", `Orders must stay open at least ${Math.round(ctx.config.OTC_MIN_TTL_SECONDS / 60)} minutes.`);
  if (ttl > ctx.config.OTC_MAX_TTL_SECONDS) throw new AppError("VALIDATION", `Orders can stay open at most ${Math.round(ctx.config.OTC_MAX_TTL_SECONDS / 86400)} days.`);
  if (payload.platformFeeBps !== ctx.config.OTC_PLATFORM_FEE_BPS || payload.feeMode !== ctx.config.OTC_FEE_MODE) {
    throw new AppError("FEE_MISMATCH", `Current platform fee is ${ctx.config.OTC_PLATFORM_FEE_BPS} bps (${ctx.config.OTC_FEE_MODE}). Please re-sign with these terms.`);
  }

  const token = await ctx.market.ensureToken(payload.tokenMint);
  if (!token) throw new AppError("NOT_FOUND", "Token mint not found on this network.");
  if (!token.isPumpToken) throw new AppError("VALIDATION", "Only Pump.fun tokens can be traded OTC here.");
  if (token.tokenProgram !== payload.tokenProgram) throw new AppError("TOKEN_PROGRAM_MISMATCH");
  if (token.decimals !== payload.tokenDecimals) throw new AppError("VALIDATION", "Token decimals in the order do not match the mint.");

  const mint = await ctx.chain.getMint(payload.tokenMint, { allowFreezeAuthority: ctx.config.OTC_ALLOW_FREEZE_AUTHORITY });
  if (!mint) throw new AppError("NOT_FOUND", "Token mint not found on this network.");
  if (!mint.safety.ok) throw new AppError("TOKEN_UNSUPPORTED_EXTENSION", mint.safety.blockers.join(" "), { blockers: mint.safety.blockers });

  const open = await ctx.db.otcOrder.count({ where: { makerWallet: viewer, status: { in: ["OPEN", "NEGOTIATING", "ACCEPTED", "SETTLEMENT_READY", "PARTIALLY_FILLED"] } } });
  if (open >= ctx.config.OTC_MAX_OPEN_ORDERS_PER_WALLET) throw new AppError("RATE_LIMITED", "You have too many open orders. Cancel some before posting more.");

  // Anti-spam soft checks (authoritative balance checks happen again immediately before settlement).
  const amount = BigInt(payload.tokenAmountRaw);
  if (payload.side === "SELL") {
    const ata = getAssociatedTokenAddressSync(new PublicKey(payload.tokenMint), new PublicKey(viewer), false, new PublicKey(payload.tokenProgram));
    const [info] = await ctx.chain.getAccounts([ata.toBase58()]);
    const acc = inspectTokenAccountInfo(ata, info ?? null);
    if (acc.amount < (payload.allowPartialFill ? BigInt(payload.minimumFillAmountRaw) : amount)) {
      throw new AppError("SELLER_INSUFFICIENT_TOKENS", "Your wallet does not hold enough of this token to post this offer.");
    }
  } else {
    const [info] = await ctx.chain.getAccounts([viewer]);
    if (BigInt(info?.lamports ?? 0) < BigInt(payload.quoteAmountRaw) / 10n) {
      throw new AppError("BUYER_INSUFFICIENT_SOL", "Your wallet holds too little SOL to back this bid.");
    }
  }
  return token;
}

async function insertOrder(
  ctx: OtcContext,
  payload: OrderPayload,
  signature: string,
  message: string,
  orderHash: string,
  link: { parentOrderId: string | null; rootOrderId: string | null; rootNegotiationId: string | null; revision: number },
) {
  const ref = await ctx.market.referencePrice(payload.tokenMint).catch(() => null);
  const price = orderUnitPrice(BigInt(payload.quoteAmountRaw), BigInt(payload.tokenAmountRaw), payload.tokenDecimals);
  return {
    id: payload.orderId,
    publicId: generatePublicId(),
    orderHash,
    version: payload.version,
    environment: payload.environment,
    network: payload.network,
    genesisHash: payload.genesisHash,
    makerWallet: payload.makerWallet,
    takerWallet: payload.takerWallet,
    tokenMint: payload.tokenMint,
    tokenProgram: payload.tokenProgram,
    tokenDecimals: payload.tokenDecimals,
    side: payload.side,
    tokenAmountRaw: dec(payload.tokenAmountRaw),
    quoteMint: payload.quoteMint,
    quoteAmountRaw: dec(payload.quoteAmountRaw),
    priceDecimal: new Prisma.Decimal(decimalToDbString(price)),
    allowPartialFill: payload.allowPartialFill,
    minimumFillAmountRaw: dec(payload.minimumFillAmountRaw),
    platformFeeBps: payload.platformFeeBps,
    feeMode: payload.feeMode,
    metadataVersion: payload.metadataVersion,
    note: payload.note,
    nonce: payload.nonce,
    salt: payload.salt,
    status: "OPEN" as const,
    signedMessage: message,
    signature,
    createdAt: new Date(payload.createdAt * 1000),
    expiresAt: new Date(payload.expiresAt * 1000),
    parentOrderId: link.parentOrderId,
    rootOrderId: link.rootOrderId ?? payload.orderId,
    rootNegotiationId: link.rootNegotiationId,
    revision: link.revision,
    refPriceSolPerToken: ref ? new Prisma.Decimal(ref.priceSolPerToken) : null,
    refPriceAt: ref?.at ?? null,
  };
}

function mapInsertError(e: unknown): never {
  const u = uniqueViolation(e);
  if (u) {
    if (u.includes("nonce")) throw new AppError("NONCE_REUSED");
    throw new AppError("ORDER_DUPLICATE");
  }
  throw e;
}

/** POST /api/otc/orders — publish a new public ask/bid or a private offer. */
export async function createOrder(ctx: OtcContext, input: { payload: unknown; signature: string; viewer: string; ip?: string }) {
  const { payload, orderHash, message } = mapVerify(verifyOrder(input.payload, input.signature, domainOf(ctx.config)));
  if (payload.parentOrderHash !== null) throw new AppError("VALIDATION", "Counteroffers must be posted to /counter.");
  await validateNewOrder(ctx, payload, input.viewer);
  const data = await insertOrder(ctx, payload, input.signature, message, orderHash, { parentOrderId: null, rootOrderId: null, rootNegotiationId: null, revision: 0 });

  let pending: NotifyInput[] = [];
  const order = await ctx.db
    .$transaction(async (tx) => {
      const created = await tx.otcOrder.create({ data });
      await tx.otcOrderSignature.create({ data: { orderId: created.id, kind: "ORDER", signer: payload.makerWallet, message, signature: input.signature, nonce: payload.nonce } });
      if (payload.takerWallet) {
        const n = await tx.otcNegotiation.create({ data: { rootOrderId: created.id, makerWallet: payload.makerWallet, counterpartyWallet: payload.takerWallet, latestOrderId: created.id } });
        await tx.otcOrder.update({ where: { id: created.id }, data: { rootNegotiationId: n.id } });
        pending = await notify(tx, [
          {
            wallet: payload.takerWallet,
            type: payload.side === "SELL" ? "OFFER_RECEIVED" : "BID_RECEIVED",
            title: payload.side === "SELL" ? "Private offer received" : "Private bid received",
            body: `A wallet sent you a private ${payload.side === "SELL" ? "offer to sell" : "bid to buy"} tokens.`,
            link: `/deal/${created.publicId}`,
            orderId: created.id,
          },
        ]);
      }
      await audit(tx, { actor: payload.makerWallet, action: "order.created", entityType: "OtcOrder", entityId: created.id, toStatus: "OPEN", data: { orderHash, private: payload.takerWallet !== null }, ip: input.ip ?? null });
      return tx.otcOrder.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
    })
    .catch(mapInsertError);
  await publishNotifications(ctx.kv, pending);
  await ctx.kv.publish(`otc:${payload.tokenMint}`, JSON.stringify({ kind: "order", id: order.id })).catch(() => {});
  return orderView(order);
}

/** POST /api/otc/orders/:id/counter — a NEW signed order version; the parent payload is never mutated. */
export async function counterOrder(ctx: OtcContext, parentId: string, input: { payload: unknown; signature: string; viewer: string; ip?: string }) {
  const { payload, orderHash, message } = mapVerify(verifyOrder(input.payload, input.signature, domainOf(ctx.config)));
  const parent = await ctx.db.otcOrder.findUnique({ where: { id: parentId }, include: { negotiation: true } });
  if (!parent || !canView(parent, input.viewer)) throw new AppError("NOT_FOUND", "Order not found.");
  const parentStatus = parent.status as OrderStatus;
  if (TERMINAL_STATUSES.has(parentStatus)) throw conflictFor(parentStatus);
  if (parent.expiresAt.getTime() <= ctx.now().getTime()) throw new AppError("ORDER_EXPIRED");
  if (payload.parentOrderHash !== parent.orderHash) throw new AppError("VALIDATION", "Counteroffer is not bound to this order's hash.");
  if (input.viewer === parent.makerWallet) throw new AppError("SELF_TRADE", "You cannot counter your own order.");
  if (parent.takerWallet !== null && parent.takerWallet !== input.viewer) throw new AppError("NOT_COUNTERPARTY");
  if (payload.takerWallet !== parent.makerWallet) throw new AppError("VALIDATION", "A counteroffer must be addressed to the other party.");
  if (payload.side === parent.side) throw new AppError("VALIDATION", "A counteroffer takes the opposite side.");
  if (payload.tokenMint !== parent.tokenMint || payload.tokenProgram !== parent.tokenProgram || payload.tokenDecimals !== parent.tokenDecimals) {
    throw new AppError("VALIDATION", "A counteroffer must be for the same token.");
  }
  if (parent.negotiation) {
    if (parent.negotiation.latestOrderId !== parent.id) throw new AppError("ORDER_NOT_LATEST_REVISION");
    const parties = [parent.negotiation.makerWallet, parent.negotiation.counterpartyWallet];
    if (!parties.includes(input.viewer)) throw new AppError("NOT_COUNTERPARTY");
  }
  await validateNewOrder(ctx, payload, input.viewer);

  let pending: NotifyInput[] = [];
  const order = await ctx.db
    .$transaction(async (tx) => {
      let negotiationId = parent.rootNegotiationId;
      if (!negotiationId) {
        // First counter on a public order opens a thread between its maker and this wallet.
        const existing = await tx.otcNegotiation.findUnique({ where: { rootOrderId_counterpartyWallet: { rootOrderId: parent.id, counterpartyWallet: input.viewer } } });
        negotiationId =
          existing?.id ??
          (await tx.otcNegotiation.create({ data: { rootOrderId: parent.id, makerWallet: parent.makerWallet, counterpartyWallet: input.viewer, latestOrderId: parent.id } })).id;
      }
      const negotiation = await tx.otcNegotiation.findUniqueOrThrow({ where: { id: negotiationId } });
      if (negotiation.status !== "OPEN") throw new AppError("ORDER_NOT_ACCEPTABLE", "This negotiation is closed.");
      // Only the thread head may be countered. The conditional update is the optimistic lock: of two
      // concurrent counters to the same revision, exactly one moves the head.
      if (negotiation.latestOrderId !== parent.id) throw new AppError("ORDER_NOT_LATEST_REVISION");
      const head = await tx.otcNegotiation.updateMany({
        where: { id: negotiationId, latestOrderId: parent.id },
        data: { latestOrderId: payload.orderId, latestRevision: parent.revision + 1 },
      });
      if (head.count !== 1) throw new AppError("ORDER_NOT_LATEST_REVISION");

      const data = await insertOrder(ctx, payload, input.signature, message, orderHash, {
        parentOrderId: parent.id,
        rootOrderId: parent.rootOrderId,
        rootNegotiationId: negotiationId,
        revision: parent.revision + 1,
      });
      const created = await tx.otcOrder.create({ data });
      await tx.otcOrderSignature.create({ data: { orderId: created.id, kind: "ORDER", signer: payload.makerWallet, message, signature: input.signature, nonce: payload.nonce } });
      // A private thread's superseded revision stops being acceptable; a public root stays OPEN for others.
      if (parent.rootNegotiationId !== null && (parentStatus === "OPEN" || parentStatus === "PARTIALLY_FILLED")) {
        await transitionOrder(tx, { orderId: parent.id, to: "NEGOTIATING", from: ["OPEN"], actor: input.viewer, reason: `Countered by revision ${parent.revision + 1}` }).catch((e) => {
          if (parentStatus !== "PARTIALLY_FILLED") throw e;
        });
      }
      await audit(tx, { actor: input.viewer, action: "order.countered", entityType: "OtcOrder", entityId: created.id, toStatus: "OPEN", data: { parentOrderId: parent.id, orderHash, revision: parent.revision + 1 }, ip: input.ip ?? null });
      pending = await notify(tx, [
        {
          wallet: parent.makerWallet,
          type: "COUNTEROFFER",
          title: "New counteroffer",
          body: `You received a counteroffer (revision ${parent.revision + 1}).`,
          link: `/deal/${created.publicId}`,
          orderId: created.id,
        },
      ]);
      return tx.otcOrder.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
    })
    .catch(mapInsertError);
  await publishNotifications(ctx.kv, pending);
  return orderView(order);
}

/** POST /api/otc/orders/:id/accept — record a signed acceptance and reserve the order for settlement. */
export async function acceptOrder(ctx: OtcContext, orderId: string, input: { payload: unknown; signature: string; viewer: string; ip?: string }) {
  const order = await ctx.db.otcOrder.findUnique({ where: { id: orderId }, include: { negotiation: true } });
  if (!order || !canView(order, input.viewer)) throw new AppError("NOT_FOUND", "Order not found.");
  const status = order.status as OrderStatus;
  if (!ACCEPTABLE_STATUSES.has(status)) throw conflictFor(status);
  if (order.expiresAt.getTime() <= ctx.now().getTime()) throw new AppError("ORDER_EXPIRED");
  if (input.viewer === order.makerWallet) throw new AppError("SELF_TRADE");
  if (order.takerWallet !== null && order.takerWallet !== input.viewer) throw new AppError("NOT_COUNTERPARTY");
  if (order.negotiation && order.negotiation.latestOrderId !== order.id) throw new AppError("ORDER_NOT_LATEST_REVISION");

  const { payload, message, hash } = mapVerify(verifyAccept(input.payload, input.signature, domainOf(ctx.config), { tokenMint: order.tokenMint, tokenDecimals: order.tokenDecimals, side: order.side }));
  if (payload.acceptor !== input.viewer) throw new AppError("FORBIDDEN");
  if (payload.orderHash !== order.orderHash) throw new AppError("VALIDATION", "Acceptance is bound to a different order.");
  if (!isFresh(payload.signedAt, nowSeconds(ctx))) throw new AppError("VALIDATION", "Acceptance signature is stale. Please sign again.");

  // Anti-griefing: acceptances are free to sign, so cap how many orders one wallet can hold at once
  // and require it to plausibly be able to settle (the authoritative check runs again at settlement).
  const holds = await ctx.db.otcOrder.count({ where: { status: { in: ["ACCEPTED", "SETTLEMENT_READY"] }, signatures: { some: { kind: "ACCEPT", signer: input.viewer } }, acceptanceExpiresAt: { gt: ctx.now() } } });
  if (holds >= MAX_CONCURRENT_HOLDS) throw new AppError("RATE_LIMITED", `You already have ${holds} accepted orders awaiting settlement. Settle or let them lapse first.`);

  const fill = BigInt(payload.fillAmountRaw);
  const filled = big(order.filledAmountRaw);
  const fc = checkFill({ allowPartialFill: order.allowPartialFill, tokenAmountRaw: big(order.tokenAmountRaw), minimumFillAmountRaw: big(order.minimumFillAmountRaw) }, filled, fill);
  if (!fc.ok) throw new AppError(fc.code!);
  const expectedQuote = quoteForFill({ side: order.side, tokenAmountRaw: big(order.tokenAmountRaw), quoteAmountRaw: big(order.quoteAmountRaw) }, filled, fill);
  if (expectedQuote.toString() !== payload.quoteAmountRaw) throw new AppError("VALIDATION", "Acceptance price does not match the order.");
  if (order.side === "SELL") {
    const [info] = await ctx.chain.getAccounts([input.viewer]);
    if (BigInt(info?.lamports ?? 0) < expectedQuote) throw new AppError("BUYER_INSUFFICIENT_SOL", "Your wallet doesn't hold enough SOL to pay for this fill.");
  } else {
    const ata = getAssociatedTokenAddressSync(new PublicKey(order.tokenMint), new PublicKey(input.viewer), false, new PublicKey(order.tokenProgram));
    const [info] = await ctx.chain.getAccounts([ata.toBase58()]);
    if (inspectTokenAccountInfo(ata, info ?? null).amount < fill) throw new AppError("SELLER_INSUFFICIENT_TOKENS", "Your wallet doesn't hold enough of this token to fill this bid.");
  }

  let pending: NotifyInput[] = [];
  const holdUntil = new Date(ctx.now().getTime() + ACCEPT_HOLD_SECONDS * 1000);
  await ctx.db
    .$transaction(async (tx) => {
      const sig = await tx.otcOrderSignature.create({ data: { orderId, kind: "ACCEPT", signer: input.viewer, message, signature: input.signature, nonce: payload.nonce, fillAmountRaw: dec(fill) } });
      await transitionOrder(tx, {
        orderId,
        to: "ACCEPTED",
        from: ["OPEN", "PARTIALLY_FILLED"],
        actor: input.viewer,
        reason: `Accepted by ${input.viewer}`,
        data: { acceptHash: hash, fillAmountRaw: fill.toString() },
        extra: { activeAcceptanceId: sig.id, acceptanceExpiresAt: holdUntil },
      });
      if (order.negotiation) await tx.otcNegotiation.update({ where: { id: order.negotiation.id }, data: { status: "AGREED" } });
      pending = await notify(tx, [
        { wallet: order.makerWallet, type: "OFFER_ACCEPTED", title: "Your order was accepted", body: "Review and sign the settlement transaction.", link: `/deal/${order.publicId}`, orderId },
        { wallet: order.makerWallet, type: "SIGNATURE_REQUIRED", title: "Signature required", body: "Settlement is waiting for your signature.", link: `/deal/${order.publicId}`, orderId },
      ]);
    })
    .catch((e) => {
      if (uniqueViolation(e)) throw new AppError("NONCE_REUSED", "This acceptance was already submitted.");
      throw e;
    });
  await publishNotifications(ctx.kv, pending);
  return getOrder(ctx, orderId, input.viewer);
}

/** POST /api/otc/orders/:id/cancel — maker-signed cancellation. */
export async function cancelOrder(ctx: OtcContext, orderId: string, input: { payload: unknown; signature: string; viewer: string; ip?: string }) {
  const order = await ctx.db.otcOrder.findUnique({ where: { id: orderId } });
  if (!order || !canView(order, input.viewer)) throw new AppError("NOT_FOUND", "Order not found.");
  if (order.makerWallet !== input.viewer) throw new AppError("FORBIDDEN", "Only the order's maker can cancel it.");
  const status = order.status as OrderStatus;
  if (!CANCELLABLE_STATUSES.has(status)) throw conflictFor(status);
  const { payload, message, hash } = mapVerify(verifyCancel(input.payload, input.signature, domainOf(ctx.config)));
  if (payload.maker !== order.makerWallet || payload.orderHash !== order.orderHash) throw new AppError("VALIDATION", "Cancellation does not match this order.");
  if (!isFresh(payload.signedAt, nowSeconds(ctx))) throw new AppError("VALIDATION", "Cancellation signature is stale. Please sign again.");

  let pending: NotifyInput[] = [];
  await ctx.db
    .$transaction(async (tx) => {
      await tx.otcOrderSignature.create({ data: { orderId, kind: "CANCEL", signer: input.viewer, message, signature: input.signature, nonce: payload.nonce } });
      await transitionOrder(tx, { orderId, to: "CANCELLED", actor: input.viewer, reason: "Cancelled by maker", data: { cancelHash: hash }, extra: { cancelledAt: ctx.now(), activeAcceptanceId: null, acceptanceExpiresAt: null } });
      // Stop collecting signatures for any live settlement. A SUBMITTED one may still land (it was
      // fully co-signed before the cancel); the reconciler records the chain's outcome.
      await tx.otcSettlement.updateMany({
        where: { orderId, status: { in: ["AWAITING_BUYER_SIGNATURE", "AWAITING_SELLER_SIGNATURE", "READY_TO_SUBMIT"] } },
        data: { status: "FAILED", failureReason: "Order cancelled by maker", activeLock: null },
      });
      if (order.rootNegotiationId) await tx.otcNegotiation.updateMany({ where: { id: order.rootNegotiationId, latestOrderId: order.id }, data: { status: "CLOSED" } });
      const counterparty = order.takerWallet;
      if (counterparty) {
        pending = await notify(tx, [{ wallet: counterparty, type: "ORDER_CANCELLED", title: "Offer cancelled", body: "The maker cancelled this offer.", link: `/deal/${order.publicId}`, orderId }]);
      }
    })
    .catch((e) => {
      if (uniqueViolation(e)) throw new AppError("NONCE_REUSED", "This cancellation was already submitted.");
      throw e;
    });
  await publishNotifications(ctx.kv, pending);
  return getOrder(ctx, orderId, input.viewer);
}

export async function getOrder(ctx: OtcContext, idOrPublicId: string, viewer: string | null) {
  const order = await ctx.db.otcOrder.findFirst({ where: { OR: [{ id: idOrPublicId }, { publicId: idOrPublicId }] }, include: orderInclude });
  if (!order || !canView(order, viewer)) throw new AppError("NOT_FOUND", "Order not found.");
  return orderView(order);
}

/** Restricted lookup for /deal/[publicId]: unrelated wallets learn only that the deal is private. */
export async function getDeal(ctx: OtcContext, publicId: string, viewer: string | null) {
  const order = await ctx.db.otcOrder.findUnique({ where: { publicId }, include: orderInclude });
  if (!order) throw new AppError("NOT_FOUND", "Deal not found.");
  if (!canView(order, viewer)) return { restricted: true as const, isPrivate: true };
  const thread = await negotiationFor(ctx, order, viewer);
  const settlement = await ctx.db.otcSettlement.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
  return { restricted: false as const, order: orderView(order), negotiation: thread, latestSettlementId: settlement?.id ?? null };
}

async function negotiationFor(ctx: OtcContext, order: OtcOrder, viewer: string | null) {
  if (!order.rootNegotiationId) {
    if (!viewer) return null;
    const n = await ctx.db.otcNegotiation.findUnique({ where: { rootOrderId_counterpartyWallet: { rootOrderId: order.id, counterpartyWallet: viewer } } });
    if (!n) return null;
    const revs = await ctx.db.otcOrder.findMany({ where: { OR: [{ id: order.id }, { rootNegotiationId: n.id }] }, include: orderInclude, orderBy: { revision: "asc" } });
    return negotiationView(n, revs);
  }
  const n = await ctx.db.otcNegotiation.findUnique({ where: { id: order.rootNegotiationId } });
  if (!n) return null;
  if (viewer !== n.makerWallet && viewer !== n.counterpartyWallet) return null;
  const revs = await ctx.db.otcOrder.findMany({ where: { OR: [{ id: n.rootOrderId }, { rootNegotiationId: n.id }] }, include: orderInclude, orderBy: { revision: "asc" } });
  return negotiationView(n, revs);
}

export interface ListOrdersQuery {
  mint?: string;
  side?: "BUY" | "SELL";
  maker?: string;
  status?: OrderStatus[];
  /** Include private orders where the viewer is a party. */
  mine?: boolean;
  limit: number;
  cursor?: string;
}

/** Public orderbook + the viewer's own private orders. Never returns other people's private orders. */
export async function listOrders(ctx: OtcContext, q: ListOrdersQuery, viewer: string | null) {
  const visibility: Prisma.OtcOrderWhereInput = q.mine && viewer ? { OR: [{ makerWallet: viewer }, { takerWallet: viewer }] } : { takerWallet: null };
  const where: Prisma.OtcOrderWhereInput = {
    AND: [
      visibility,
      { isDemo: false }, // test-fixture rows never appear in listings
      q.mint ? { tokenMint: q.mint } : {},
      q.side ? { side: q.side } : {},
      q.maker ? { makerWallet: q.maker } : {},
      q.status ? { status: { in: q.status } } : { status: { in: ["OPEN", "PARTIALLY_FILLED", "ACCEPTED", "SETTLEMENT_READY"] }, expiresAt: { gt: ctx.now() } },
    ],
  };
  const rows = await ctx.db.otcOrder.findMany({
    where,
    include: orderInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, q.limit);
  return { items: page.map(orderView), nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
}

export { buildAcceptMessage, buildCancelMessage, hashPayload };
