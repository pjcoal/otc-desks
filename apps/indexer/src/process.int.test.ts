import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Connection, Keypair, MessageV0, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { getPumpProgram, pumpIdl } from "@pump-fun/pump-sdk";
import { createPrismaClient, type Db } from "@app/database";
import { PUMP_PROGRAM_ID } from "@app/pump";
import { indexTransaction } from "./process";

// Test-only: the real Anchor coder from the official IDL produces byte-exact event payloads.
const coder = getPumpProgram(new Connection("http://127.0.0.1:1")).coder;
const disc = (name: string) => Buffer.from((pumpIdl as unknown as { events: Array<{ name: string; discriminator: number[] }> }).events.find((e) => e.name === name)!.discriminator);

function eventLog(name: string, typeName: string, data: Record<string, unknown>): string {
  return `Program data: ${Buffer.concat([disc(name), coder.types.encode(typeName, data)]).toString("base64")}`;
}

const zero = PublicKey.default;
function tradeEvent(mint: PublicKey, user: PublicKey, isBuy: boolean, sol: bigint, tokens: bigint) {
  const b = (v: bigint | number) => new BN(v.toString());
  return {
    mint, solAmount: b(sol), tokenAmount: b(tokens), isBuy, user, timestamp: b(1_790_000_000),
    virtualSolReserves: b(30_000_000_000n), virtualTokenReserves: b(1_073_000_000_000_000n), realSolReserves: b(0), realTokenReserves: b(793_100_000_000_000n),
    feeRecipient: zero, feeBasisPoints: b(95), fee: b(950_000), creator: zero, creatorFeeBasisPoints: b(30), creatorFee: b(300_000),
    trackVolume: false, totalUnclaimedTokens: b(0), totalClaimedTokens: b(0), currentSolVolume: b(0), lastUpdateTimestamp: b(0), ixName: isBuy ? "buy" : "sell",
    mayhemMode: false, cashbackFeeBasisPoints: b(0), cashback: b(0), buybackFeeBasisPoints: b(0), buybackFee: b(0), shareholders: [],
    quoteMint: zero, quoteAmount: b(sol), virtualQuoteReserves: b(30_000_000_000n), realQuoteReserves: b(0), holderRewardsBps: b(0), holderRewards: b(0),
  };
}

function fakeTx(logs: string[], slot = 1000) {
  const payer = Keypair.generate().publicKey;
  const message = MessageV0.compile({ payerKey: payer, instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })], recentBlockhash: PublicKey.unique().toBase58() });
  return {
    slot,
    blockTime: 1_790_000_000,
    transaction: { message, signatures: [] },
    meta: { err: null, logMessages: [`Program ${PUMP_PROGRAM_ID.toBase58()} invoke [1]`, ...logs, `Program ${PUMP_PROGRAM_ID.toBase58()} success`], innerInstructions: [], loadedAddresses: { writable: [], readonly: [] } },
    version: 0,
  } as never;
}

let db: Db;
beforeAll(() => {
  db = createPrismaClient(inject("databaseUrl"));
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "PumpEvent", "Trade", "Token" CASCADE`);
});

describe("indexer transaction processing", () => {
  const opts = { tracked: null, poolToMint: async () => null };

  it("stores a create + buy, derives price, and is idempotent on replay", async () => {
    const mint = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;
    const create = eventLog("CreateEvent", "createEvent", {
      name: "Test", symbol: "TST", uri: "https://example.com/m.json", mint, bondingCurve: zero, user, creator: user, timestamp: new BN(1_790_000_000),
      virtualTokenReserves: new BN("1073000000000000"), virtualSolReserves: new BN("30000000000"), realTokenReserves: new BN("793100000000000"), tokenTotalSupply: new BN("1000000000000000"),
      tokenProgram: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), isMayhemMode: false, isCashbackEnabled: false, quoteMint: zero, virtualQuoteReserves: new BN("30000000000"), creatorFeeBps: new BN(0), isHolderReward: false,
    });
    const buy = eventLog("TradeEvent", "tradeEvent", tradeEvent(mint, user, true, 1_000_000_000n, 34_000_000_000_000n));
    const tx = fakeTx([create, buy]);
    const r1 = await indexTransaction(db, "sig1", tx, opts);
    expect(r1).toMatchObject({ events: 2, trades: 1 });
    expect(r1.newMints.has(mint.toBase58())).toBe(true);
    const token = await db.token.findUniqueOrThrow({ where: { mint: mint.toBase58() } });
    expect(token).toMatchObject({ symbol: "TST", creator: user.toBase58(), createSignature: "sig1" });
    const trade = await db.trade.findFirstOrThrow({ where: { mint: mint.toBase58() } });
    expect(trade.side).toBe("BUY");
    expect(trade.solAmount.toFixed()).toBe("1000000000");
    expect(trade.priceSolPerToken.toFixed()).toMatch(/^0\.0000000294117647/); // 1 SOL / 34M tokens, stored at 18 dp

    const r2 = await indexTransaction(db, "sig1", tx, opts);
    expect(r2).toMatchObject({ events: 0, trades: 0 });
    expect(await db.trade.count()).toBe(1);
  });

  it("tracked mode ignores mints we do not track", async () => {
    const mint = Keypair.generate().publicKey;
    const r = await indexTransaction(db, "sig2", fakeTx([eventLog("TradeEvent", "tradeEvent", tradeEvent(mint, mint, false, 10n, 10n))]), { tracked: new Set(), poolToMint: async () => null });
    expect(r.events).toBe(0);
  });

  it("skips failed transactions entirely", async () => {
    const mint = Keypair.generate().publicKey;
    const tx = fakeTx([eventLog("TradeEvent", "tradeEvent", tradeEvent(mint, mint, true, 10n, 10n))]) as unknown as { meta: { err: unknown } };
    tx.meta.err = { InstructionError: [0, { Custom: 6002 }] };
    expect((await indexTransaction(db, "sig3", tx as never, opts)).events).toBe(0);
  });
});
