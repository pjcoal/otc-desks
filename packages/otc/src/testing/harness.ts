/** Shared harness for OTC integration tests: real Postgres + LiteSVM chain + in-memory KV. */
import { Keypair, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { Db } from "@app/database";
import { createMemoryStore, loadServerConfig, type ServerConfig } from "@app/shared/server";
import { toBase64, fromBase64 } from "@app/solana";
import { buildAcceptMessage, buildCancelMessage, buildOrderMessage } from "../messages";
import { newAcceptPayload, newCancelPayload, newOrderPayload, type NewOrderInput } from "../build";
import { hashPayload } from "../canonical";
import { quoteForFill } from "../amounts";
import { domainOf, type MarketReader, type OtcContext } from "../server/context";
import type { OrderView, SettlementView } from "../dto";
import { LiteSvmGateway } from "./litesvm-gateway";

export const SOL = 1_000_000_000n;

const TABLES = ["Notification", "AuditEvent", "PlatformFee", "ReferralPayout", "OtcSettlement", "OtcOrderSignature", "OtcOrder", "OtcNegotiation", "TransactionRecord", "ReferralAttribution", "MarketState", "TokenMetadata", "Token"];

export async function resetDb(db: Db) {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export interface Harness {
  ctx: OtcContext;
  chain: LiteSvmGateway;
  config: ServerConfig;
  treasury: Keypair;
  mint: ReturnType<LiteSvmGateway["createMint"]>;
  clock: { offsetMs: number };
}

export function makeHarness(db: Db, opts: { transferFeeBps?: number; env?: Record<string, string> } = {}): Harness {
  const chain = new LiteSvmGateway();
  const treasury = Keypair.generate();
  chain.airdrop(treasury.publicKey, SOL);
  const config = loadServerConfig({
    NODE_ENV: "test",
    APP_URL: "http://localhost:3000",
    SOLANA_CLUSTER: "devnet",
    PLATFORM_TREASURY_WALLET: treasury.publicKey.toBase58(),
    OTC_PLATFORM_FEE_BPS: "50",
    OTC_FEE_MODE: "SELLER_PAYS",
    OTC_REFERRAL_SHARE_BPS: "2000",
    ...opts.env,
  });
  const mint = chain.createMint({ ...(opts.transferFeeBps ? { transferFeeBps: opts.transferFeeBps } : {}) });
  const clock = { offsetMs: 0 };
  const market: MarketReader = {
    async ensureToken(m) {
      const info = await chain.getMint(m, { allowFreezeAuthority: false });
      if (!info) return null;
      await db.token.upsert({ where: { mint: m }, create: { mint: m, tokenProgram: info.programId.toBase58(), decimals: info.decimals, name: "Test Token", symbol: "TOKEN", venue: "PUMP_BONDING_CURVE" }, update: {} });
      return { mint: m, tokenProgram: info.programId.toBase58(), decimals: info.decimals, symbol: "TOKEN", name: "Test Token", imageUrl: null, isPumpToken: true };
    },
    async referencePrice() {
      return { priceSolPerToken: "0.000002", at: new Date(), venue: "PUMP_BONDING_CURVE" };
    },
  };
  const ctx: OtcContext = { db, chain, config, kv: createMemoryStore(), market, now: () => new Date(Date.now() + clock.offsetMs) };
  return { ctx, chain, config, treasury, mint, clock };
}

export function wallet(h: Harness, lamports = 100n * SOL, tokens = 0n): Keypair {
  const kp = Keypair.generate();
  h.chain.airdrop(kp.publicKey, lamports);
  if (tokens > 0n) h.chain.mintTo(h.mint, kp.publicKey, tokens);
  return kp;
}

const signText = (kp: Keypair, text: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));

export function signedOrder(h: Harness, maker: Keypair, over: Partial<NewOrderInput>) {
  const payload = newOrderPayload(domainOf(h.config), {
    makerWallet: maker.publicKey.toBase58(),
    takerWallet: null,
    tokenMint: h.mint.mint.toBase58(),
    tokenProgram: h.mint.programId.toBase58(),
    tokenDecimals: 6,
    side: "SELL",
    tokenAmountRaw: 20_000_000_000_000n,
    quoteAmountRaw: 40n * SOL,
    ttlSeconds: 3600,
    allowPartialFill: false,
    platformFeeBps: 50,
    feeMode: "SELLER_PAYS",
    ...over,
  }, Math.floor(h.ctx.now().getTime() / 1000));
  return { payload, signature: signText(maker, buildOrderMessage(payload)), viewer: maker.publicKey.toBase58() };
}

export function signedCounter(h: Harness, maker: Keypair, parent: OrderView, over: Partial<NewOrderInput>) {
  return signedOrder(h, maker, {
    side: parent.side === "SELL" ? "BUY" : "SELL",
    takerWallet: parent.makerWallet,
    tokenAmountRaw: BigInt(parent.tokenAmountRaw),
    parentOrderHash: parent.orderHash,
    ...over,
  });
}

export function signedAccept(h: Harness, acceptor: Keypair, order: OrderView, fill?: bigint) {
  const f = fill ?? BigInt(order.remainingAmountRaw);
  const quote = quoteForFill({ side: order.side, tokenAmountRaw: BigInt(order.tokenAmountRaw), quoteAmountRaw: BigInt(order.quoteAmountRaw) }, BigInt(order.filledAmountRaw), f);
  const payload = newAcceptPayload(domainOf(h.config), order.orderHash, acceptor.publicKey.toBase58(), f, quote, Math.floor(h.ctx.now().getTime() / 1000));
  return { payload, signature: signText(acceptor, buildAcceptMessage(payload, { tokenMint: order.token.mint, tokenDecimals: order.token.decimals, side: order.side })), viewer: acceptor.publicKey.toBase58() };
}

export function signedCancel(h: Harness, maker: Keypair, order: OrderView, signedAtOffset = 0) {
  const payload = newCancelPayload(domainOf(h.config), order.orderHash, maker.publicKey.toBase58(), Math.floor(h.ctx.now().getTime() / 1000) + signedAtOffset);
  return { payload, signature: signText(maker, buildCancelMessage(payload)), viewer: maker.publicKey.toBase58() };
}

/** What a wallet's signTransaction returns: the same message with its own signature filled in. */
export function walletSign(s: SettlementView, kp: Keypair): string {
  const tx = new VersionedTransaction(VersionedMessage.deserialize(fromBase64(s.messageBase64)));
  tx.sign([kp]);
  return toBase64(tx.serialize());
}

export { hashPayload };
