import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createPrismaClient, dec, type Db } from "@app/database";
import { loadServerConfig } from "@app/shared/server";
import { listingRules } from "./listing";
import { explore, searchTokens } from "./queries";

let db: Db;
beforeAll(() => {
  db = createPrismaClient(inject("databaseUrl"));
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "Token" CASCADE`);
});

const HOUR = 3600_000;
const SOL_USD = "100"; // $500k market cap = 5,000 SOL; $100k volume = 1,000 SOL
const mainnet = loadServerConfig({ SOLANA_CLUSTER: "mainnet-beta", OTC_PLATFORM_FEE_BPS: "0" });

async function coin(symbol: string, o: { ageHours: number; mcapSol: number; volumeUsd?: number | null; volumeUsdAgeHours?: number; volumeSol?: number; launchedHere?: boolean }) {
  const mint = Keypair.generate().publicKey.toBase58();
  const now = Date.now();
  await db.token.create({ data: { mint, name: symbol, symbol, decimals: 6, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", venue: "PUMP_BONDING_CURVE", createdAt: new Date(now - o.ageHours * HOUR), lastTradeAt: new Date(now - 60_000), launchedViaPlatform: o.launchedHere ?? false } });
  await db.marketState.create({
    data: {
      mint, venue: "PUMP_BONDING_CURVE", priceSolPerToken: "0.000001", marketCapLamports: dec(BigInt(o.mcapSol) * 1_000_000_000n), liquidityLamports: dec(0n), slot: 0n,
      volume24hLamports: dec(BigInt(o.volumeSol ?? 0) * 1_000_000_000n),
      volume24hUsd: o.volumeUsd === undefined || o.volumeUsd === null ? null : String(o.volumeUsd),
      volume24hUsdAt: o.volumeUsd === undefined || o.volumeUsd === null ? null : new Date(now - (o.volumeUsdAgeHours ?? 0) * HOUR),
    },
  });
  return mint;
}

const symbols = async (section: "new" | "trending", rules = listingRules(mainnet, SOL_USD)) => {
  const r = await explore(db, section, 48, rules);
  return r.kind === "tokens" ? r.items.map((t) => t.symbol).sort() : [];
};

describe("listing rules", () => {
  it("lists recent coins on market cap and older coins on fresh 24h volume", async () => {
    await coin("RECENTBIG", { ageHours: 10, mcapSol: 6000 }); // $600k, 10h old
    await coin("RECENTSMALL", { ageHours: 10, mcapSol: 4000, volumeUsd: 900_000 }); // $400k: volume doesn't help a recent coin
    await coin("OLDBUSY", { ageHours: 24 * 5, mcapSol: 50, volumeUsd: 150_000 });
    await coin("OLDQUIET", { ageHours: 24 * 5, mcapSol: 90_000, volumeUsd: 20_000 }); // big cap, little volume
    await coin("OLDSTALE", { ageHours: 24 * 5, mcapSol: 50, volumeUsd: 500_000, volumeUsdAgeHours: 5 }); // volume figure too old
    await coin("OLDINDEXED", { ageHours: 24 * 5, mcapSol: 50, volumeSol: 1500 }); // $150k measured by our indexer
    await coin("OWNCOIN", { ageHours: 24 * 9, mcapSol: 30, launchedHere: true });
    expect(await symbols("new")).toEqual(["OLDBUSY", "OLDINDEXED", "OWNCOIN", "RECENTBIG"]);
    expect(await symbols("trending")).toEqual(["OLDBUSY", "OLDINDEXED", "OWNCOIN", "RECENTBIG"]);
  });

  it("fails closed without a SOL/USD price: only USD-measured volume and own coins qualify", async () => {
    await coin("RECENTBIG", { ageHours: 10, mcapSol: 60_000 });
    await coin("OLDBUSY", { ageHours: 24 * 5, mcapSol: 50, volumeUsd: 150_000 });
    await coin("OLDINDEXED", { ageHours: 24 * 5, mcapSol: 50, volumeSol: 100_000 });
    expect(await symbols("new", listingRules(mainnet, null))).toEqual(["OLDBUSY"]);
  });

  it("does not filter on test clusters", async () => {
    await coin("TINY", { ageHours: 24 * 5, mcapSol: 1 });
    expect(listingRules(loadServerConfig({ SOLANA_CLUSTER: "devnet", OTC_PLATFORM_FEE_BPS: "0" }), SOL_USD)).toBeNull();
    expect(await symbols("new", null)).toEqual(["TINY"]);
  });

  it("text search returns listed coins only, but a mint always resolves", async () => {
    await coin("PEPEBIG", { ageHours: 10, mcapSol: 6000 });
    const small = await coin("PEPESMALL", { ageHours: 10, mcapSol: 10 });
    const rules = listingRules(mainnet, SOL_USD);
    expect((await searchTokens(db, "pepe", 12, rules)).map((t) => t.symbol)).toEqual(["PEPEBIG"]);
    expect((await searchTokens(db, small, 12, rules)).map((t) => t.symbol)).toEqual(["PEPESMALL"]);
  });
});
