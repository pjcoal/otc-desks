import { PublicKey, type Connection } from "@solana/web3.js";
import { AppError, D, decimalToDbString } from "@app/shared";
import { logger, type KeyValueStore, type ServerConfig } from "@app/shared/server";
import { dec, Prisma, type Db, type MarketVenue } from "@app/database";
import { inspectMintAccount, decodePythPrice, PYTH_SOL_USD_ACCOUNT, PYTH_SOL_USD_FEED_ID, type MintInspection } from "@app/solana";
import { PumpAdapter, PumpDiscoveryApi, bondingProgressBps, type DiscoveredCoin, type DiscoverySort, type MarketSnapshot } from "@app/pump";
import type { MarketReader, ReferencePrice, TokenInfo } from "@app/otc/server";
import { DexScreenerApi } from "./dexscreener";
import { listingRules, type ListingRules } from "./listing";
import { sanitizeMetadata } from "./metadata";
import { normaliseUri, safeFetchJson, type Gateways } from "./safe-fetch";

const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const TOKEN_REFRESH_MS = 6 * 60 * 60 * 1000;
const MARKET_FRESH_MS = 15_000;
/** A chain snapshot older than this may be replaced by fresher discovery data (and is re-read from chain before signing). */
const CHAIN_SNAPSHOT_KEEP_MS = 10 * 60 * 1000;
/** Upper bound on coins whose 24h volume is refreshed per discovery run (30 per DexScreener request). */
const VOLUME_REFRESH_LIMIT = 240;

/** Minimal Metaplex metadata decode (legacy SPL Pump coins): name, symbol, uri. */
function decodeMetaplex(data: Buffer): { name: string; symbol: string; uri: string } | null {
  try {
    let o = 1 + 32 + 32;
    const read = () => {
      const len = data.readUInt32LE(o);
      o += 4;
      const s = data.subarray(o, o + len).toString("utf8").replace(/\0/g, "").trim();
      o += len;
      return s;
    };
    return { name: read(), symbol: read(), uri: read() };
  } catch {
    return null;
  }
}

export interface TokenDetail {
  token: {
    mint: string;
    name: string;
    symbol: string;
    imageUrl: string | null;
    decimals: number;
    tokenProgram: string;
    creator: string | null;
    createdAt: string;
    launchedViaPlatform: boolean;
  };
  metadata: { description: string | null; website: string | null; twitter: string | null; telegram: string | null; uri: string | null; verifiedOnChain: boolean } | null;
  market: SerializedSnapshot;
  safety: MintInspection["safety"] & { extensions: string[]; freezeAuthority: string | null; mintAuthority: string | null; transferFeeBps: number | null };
  stats: { volume24hLamports: string; volume24hUsd: string | null; trades24h: number; holderCount: number | null };
}

export type SerializedSnapshot = Omit<MarketSnapshot, "supply" | "marketCapLamports" | "liquidityLamports" | "bondingCurve" | "pool"> & {
  supply: string;
  marketCapLamports: string;
  liquidityLamports: string;
  bondingCurve: Record<string, string | number | boolean> | null;
  pool: Record<string, string | number | boolean> | null;
};

export function serializeSnapshot(s: MarketSnapshot): SerializedSnapshot {
  const ser = (o: object | null) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) : null);
  return {
    mint: s.mint,
    venue: s.venue,
    ...(s.note ? { note: s.note } : {}),
    tradable: s.tradable,
    tokenProgram: s.tokenProgram,
    decimals: s.decimals,
    supply: s.supply.toString(),
    priceSolPerToken: s.priceSolPerToken,
    marketCapLamports: s.marketCapLamports.toString(),
    liquidityLamports: s.liquidityLamports.toString(),
    progressBps: s.progressBps,
    bondingCurve: ser(s.bondingCurve) as SerializedSnapshot["bondingCurve"],
    pool: ser(s.pool) as SerializedSnapshot["pool"],
    slot: s.slot,
    fetchedAt: s.fetchedAt,
  };
}

/** The guarded E2E mode (apps/web/src/server/e2e.ts): LiteSVM test chain, localnet only. */
export function isE2EFixtureMode(config: ServerConfig): boolean {
  return process.env.E2E_LITESVM === "1" && config.SOLANA_CLUSTER === "localnet";
}

export class TokenRegistry implements MarketReader {
  readonly pump: PumpAdapter;
  private readonly gw: Gateways;

  constructor(
    private readonly db: Db,
    private readonly connection: Connection,
    private readonly config: ServerConfig,
    private readonly kv: KeyValueStore,
  ) {
    this.pump = new PumpAdapter(connection);
    this.gw = { ipfs: config.IPFS_GATEWAY_URL };
  }

  /** Live snapshot from chain, persisted to MarketState. */
  async refreshMarket(mint: string): Promise<MarketSnapshot> {
    const snap = await this.pump.getMarket(mint);
    const { _curve, _poolCtx, ...clean } = snap as typeof snap & { _curve?: unknown; _poolCtx?: unknown };
    void _curve;
    void _poolCtx;
    // Only Pump coins (curve or canonical pool) are persisted, so lookups of arbitrary mints can't spam the DB.
    if (!clean.bondingCurve && !clean.pool) return clean;
    await this.upsertToken(clean);
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const agg = await this.db.trade.aggregate({ where: { mint, blockTime: { gte: since }, isDemo: false }, _sum: { solAmount: true }, _count: true });
    const data = {
      venue: clean.venue as MarketVenue,
      priceSolPerToken: new Prisma.Decimal(decimalToDbString(new D(clean.priceSolPerToken))),
      marketCapLamports: dec(clean.marketCapLamports),
      liquidityLamports: dec(clean.liquidityLamports),
      virtualSolReserves: clean.bondingCurve ? dec(clean.bondingCurve.virtualSolReserves) : null,
      virtualTokenReserves: clean.bondingCurve ? dec(clean.bondingCurve.virtualTokenReserves) : null,
      realSolReserves: clean.bondingCurve ? dec(clean.bondingCurve.realSolReserves) : null,
      realTokenReserves: clean.bondingCurve ? dec(clean.bondingCurve.realTokenReserves) : null,
      bondingProgressBps: clean.progressBps,
      volume24hLamports: agg._sum.solAmount ?? new Prisma.Decimal(0),
      trades24h: agg._count,
      slot: BigInt(clean.slot),
    };
    await this.db.marketState.upsert({ where: { mint }, create: { mint, ...data }, update: data });
    await this.kv.set(`market:${mint}`, JSON.stringify(serializeSnapshot(clean)), 15).catch(() => {});
    return clean;
  }

  private async upsertToken(s: MarketSnapshot): Promise<void> {
    const existing = await this.db.token.findUnique({ where: { mint: s.mint }, include: { metadata: true } });
    const venueData = {
      venue: s.venue as MarketVenue,
      complete: s.bondingCurve?.complete ?? s.venue === "PUMPSWAP",
      poolAddress: s.pool?.address ?? null,
      quoteMint: s.bondingCurve?.quoteMint ?? s.pool?.quoteMint ?? "SOL",
      isMayhemMode: s.bondingCurve?.isMayhemMode ?? s.pool?.isMayhemMode ?? false,
      isHolderReward: s.bondingCurve?.isHolderReward ?? false,
      ...(s.venue === "PUMPSWAP" && existing && !existing.graduatedAt ? { graduatedAt: new Date() } : {}),
    };
    if (existing && Date.now() - existing.updatedAt.getTime() < TOKEN_REFRESH_MS && existing.metadata) {
      await this.db.token.update({ where: { mint: s.mint }, data: venueData });
      return;
    }
    const { name, symbol, uri } = await this.onChainMetadata(s.mint);
    let md: ReturnType<typeof sanitizeMetadata> | null = null;
    let fetchError: string | null = null;
    if (uri) {
      try {
        md = sanitizeMetadata(await safeFetchJson(uri, this.gw), this.gw);
      } catch (e) {
        fetchError = e instanceof Error ? e.message : String(e);
        logger.debug({ mint: s.mint, err: fetchError }, "metadata fetch failed");
      }
    }
    const tokenData = {
      tokenProgram: s.tokenProgram, // always from the mint account owner
      decimals: s.decimals,
      // On-chain name/symbol are authoritative; off-chain JSON is display-only.
      name: (name || md?.name || "Unknown").slice(0, 64),
      symbol: (symbol || md?.symbol || "???").slice(0, 16),
      imageUrl: md?.image ?? null,
      creator: s.bondingCurve?.creator ?? s.pool?.coinCreator ?? existing?.creator ?? null,
      ...venueData,
    };
    await this.db.token.upsert({ where: { mint: s.mint }, create: { mint: s.mint, ...tokenData }, update: tokenData });
    if (uri) {
      const mdData = { uri, description: md?.description ?? null, image: md?.image ?? null, website: md?.website ?? null, twitter: md?.twitter ?? null, telegram: md?.telegram ?? null, raw: md ? (md as unknown as Prisma.InputJsonValue) : Prisma.JsonNull, fetchedAt: new Date(), fetchError };
      await this.db.tokenMetadata.upsert({ where: { mint: s.mint }, create: { mint: s.mint, ...mdData }, update: mdData });
    }
  }

  private async onChainMetadata(mint: string): Promise<{ name: string; symbol: string; uri: string }> {
    const key = new PublicKey(mint);
    const [mdPda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), key.toBuffer()], MPL_TOKEN_METADATA);
    const [mintInfo, mplInfo] = await this.connection.getMultipleAccountsInfo([key, mdPda]);
    if (mintInfo) {
      try {
        const insp = inspectMintAccount(key, mintInfo, { epoch: 0n });
        if (insp.onChainMetadata) return insp.onChainMetadata;
      } catch {
        // not a mint
      }
    }
    if (mplInfo && mplInfo.owner.equals(MPL_TOKEN_METADATA)) {
      const m = decodeMetaplex(mplInfo.data);
      if (m) return m;
    }
    return { name: "", symbol: "", uri: "" };
  }

  async ensureToken(mint: string): Promise<TokenInfo | null> {
    let row = await this.db.token.findUnique({ where: { mint } });
    // Discovery-only rows (MarketState.slot = 0) have not been read from chain yet: the token program
    // and decimals must come from the mint account before anything signs against them.
    if (row && !row.isDemo && ((await this.db.marketState.findUnique({ where: { mint }, select: { slot: true } }))?.slot ?? 0n) === 0n) {
      await this.refreshMarket(mint);
      row = await this.db.token.findUnique({ where: { mint } });
    }
    if (!row) {
      let snap: MarketSnapshot;
      try {
        snap = await this.refreshMarket(mint);
      } catch (e) {
        if (e instanceof AppError && e.code === "NOT_FOUND") return null;
        throw e;
      }
      row = await this.db.token.findUnique({ where: { mint } });
      if (!row) return { mint, tokenProgram: snap.tokenProgram, decimals: snap.decimals, symbol: "", name: "", imageUrl: null, isPumpToken: false };
    }
    // A Pump coin has a bonding curve (live or complete) or a canonical PumpSwap pool.
    const isPump = row.isDemo || row.venue !== "UNKNOWN" || row.complete;
    return { mint, tokenProgram: row.tokenProgram, decimals: row.decimals, symbol: row.symbol, name: row.name, imageUrl: row.imageUrl, isPumpToken: isPump };
  }

  async referencePrice(mint: string): Promise<ReferencePrice | null> {
    const m = await this.db.marketState.findUnique({ where: { mint } });
    // Only chain-read snapshots (slot > 0) count as fresh; discovery rows are approximations.
    if (m && m.slot > 0n && Date.now() - m.updatedAt.getTime() < MARKET_FRESH_MS) return { priceSolPerToken: m.priceSolPerToken.toFixed(), at: m.updatedAt, venue: m.venue };
    try {
      const snap = await this.refreshMarket(mint);
      if (snap.priceSolPerToken === "0") return null;
      return { priceSolPerToken: snap.priceSolPerToken, at: new Date(snap.fetchedAt), venue: snap.venue };
    } catch {
      return m ? { priceSolPerToken: m.priceSolPerToken.toFixed(), at: m.updatedAt, venue: m.venue } : null;
    }
  }

  async tokenDetail(mint: string): Promise<TokenDetail> {
    const fixture = await this.db.token.findUnique({ where: { mint }, include: { metadata: true, market: true } });
    if (fixture?.isDemo) {
      // End-to-end test fixtures (LiteSVM mint) only; unreachable outside the guarded localnet E2E mode.
      if (!isE2EFixtureMode(this.config)) throw new AppError("NOT_FOUND", "Mint not found.");
      return this.fixtureDetail(fixture);
    }
    const [snap, mintInfo, epoch] = await Promise.all([this.refreshMarket(mint), this.connection.getAccountInfo(new PublicKey(mint)), this.connection.getEpochInfo()]);
    if (!mintInfo) throw new AppError("NOT_FOUND", "Mint not found.");
    if (!snap.bondingCurve && !snap.pool) throw new AppError("NOT_FOUND", "This mint is not a Pump.fun token on this network.");
    const insp = inspectMintAccount(new PublicKey(mint), mintInfo, { allowFreezeAuthority: this.config.OTC_ALLOW_FREEZE_AUTHORITY, epoch: BigInt(epoch.epoch) });
    const row = await this.db.token.findUniqueOrThrow({ where: { mint }, include: { metadata: true, market: true } });
    return {
      token: {
        mint,
        name: row.name,
        symbol: row.symbol,
        imageUrl: row.imageUrl,
        decimals: row.decimals,
        tokenProgram: row.tokenProgram,
        creator: row.creator,
        createdAt: row.createdAt.toISOString(),
        launchedViaPlatform: row.launchedViaPlatform,
      },
      metadata: row.metadata
        ? { description: row.metadata.description, website: row.metadata.website, twitter: row.metadata.twitter, telegram: row.metadata.telegram, uri: row.metadata.uri, verifiedOnChain: insp.onChainMetadata?.uri === row.metadata.uri }
        : null,
      market: serializeSnapshot(snap),
      safety: { ...insp.safety, extensions: insp.extensions, freezeAuthority: insp.freezeAuthority, mintAuthority: insp.mintAuthority, transferFeeBps: insp.transferFee?.basisPoints ?? null },
      stats: { volume24hLamports: row.market?.volume24hLamports.toFixed() ?? "0", volume24hUsd: row.market?.volume24hUsd?.toFixed(2) ?? null, trades24h: row.market?.trades24h ?? 0, holderCount: row.market?.holderCount ?? null },
    };
  }

  /**
   * Refresh token lists from the optional Pump discovery API (mainnet only). Runs at most once per
   * minute across all instances (Redis lock). Discovery data seeds lists only: rows carry slot 0, and
   * any token page visit replaces the snapshot with live chain data.
   */
  async syncDiscovery(): Promise<{ synced: number } | null> {
    if (!this.config.PUMP_DISCOVERY_API || this.config.SOLANA_CLUSTER !== "mainnet-beta") return null;
    if (!(await this.kv.setNx("discovery:lock", "1", 60))) return null;
    const api = new PumpDiscoveryApi(this.config.PUMP_DISCOVERY_API_URL);
    const global = await this.pump.fetchGlobal();
    const initialVirtualTokens = BigInt(global.initialVirtualTokenReserves.toString());
    const initialRealTokens = BigInt(global.initialRealTokenReserves.toString());
    const seen = new Map<string, DiscoveredCoin>();
    const pages: Array<[DiscoverySort, number]> = [["last_trade_timestamp", 0], ["created_timestamp", 0], ["market_cap", 0], ["market_cap", 50]];
    for (const [sort, offset] of pages) {
      try {
        for (const c of await api.listCoins(sort, 50, offset)) seen.set(c.mint, c);
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : e, sort }, "pump discovery fetch failed");
      }
    }
    for (const c of seen.values()) {
      const image = c.imageUri ? normaliseUri(c.imageUri, this.gw) : null;
      const venue = c.complete ? (c.poolAddress ? "PUMPSWAP" : "UNKNOWN") : "PUMP_BONDING_CURVE";
      const real = c.realTokenReserves ?? (c.virtualTokenReserves > initialVirtualTokens - initialRealTokens ? c.virtualTokenReserves - (initialVirtualTokens - initialRealTokens) : 0n);
      const progress = bondingProgressBps(real, initialRealTokens, c.complete);
      // Curve coins: price from integer reserves. Graduated coins: the API's market cap is an approximation until a page refresh reads the pool.
      const price = !c.complete && c.virtualTokenReserves > 0n ? new D(c.virtualSolReserves.toString()).div(1e9).div(new D(c.virtualTokenReserves.toString()).div(new D(10).pow(c.decimals))) : c.apiMarketCapSol ? new D(c.apiMarketCapSol).div(1e9) : new D(0);
      const mcap = price.mul(1e9).mul(1e9).toFixed(0, D.ROUND_DOWN); // price × 1B supply, in lamports
      const existing = await this.db.token.findUnique({ where: { mint: c.mint }, select: { mint: true, isDemo: true } });
      if (existing?.isDemo) continue;
      const tokenData = { name: c.name || "Unknown", symbol: c.symbol || "???", imageUrl: image, creator: c.creator, complete: c.complete, venue: venue as MarketVenue, poolAddress: c.poolAddress, lastTradeAt: c.lastTradeAt };
      // createdAt is the coin's on-chain creation time (it drives the "recent coin" listing rule).
      await this.db.token.upsert({ where: { mint: c.mint }, create: { mint: c.mint, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", decimals: c.decimals, createdAt: c.createdAt, ...tokenData }, update: { ...tokenData, createdAt: c.createdAt } });
      const existingMarket = await this.db.marketState.findUnique({ where: { mint: c.mint }, select: { slot: true, updatedAt: true } });
      // Recent chain snapshots win. Older ones are replaced (slot 0 again), so ensureToken re-reads chain before anything signs.
      if (existingMarket && existingMarket.slot > 0n && Date.now() - existingMarket.updatedAt.getTime() < CHAIN_SNAPSHOT_KEEP_MS) continue;
      const m = { venue: venue as MarketVenue, priceSolPerToken: new Prisma.Decimal(decimalToDbString(price)), marketCapLamports: dec(mcap), liquidityLamports: dec(0n), virtualSolReserves: dec(c.virtualSolReserves), virtualTokenReserves: dec(c.virtualTokenReserves), bondingProgressBps: progress, slot: 0n };
      await this.db.marketState.upsert({ where: { mint: c.mint }, create: { mint: c.mint, ...m }, update: m });
    }
    await this.refreshVolumes([...seen.keys()]).catch((e) => logger.warn({ err: e instanceof Error ? e.message : e }, "volume refresh failed"));
    return { synced: seen.size };
  }

  /**
   * 24h USD volume from the optional listing-stats source (DexScreener). Refreshes the coins that are
   * listed on volume now (so they drop out when activity fades), then the coins just discovered.
   */
  private async refreshVolumes(discovered: string[]): Promise<void> {
    if (!this.config.DEXSCREENER_API || !this.config.isMainnet) return;
    const listedOnVolume = await this.db.marketState.findMany({
      where: { volume24hUsd: { gte: new Prisma.Decimal(this.config.LISTING_MIN_VOLUME_USD) }, token: { isDemo: false } },
      orderBy: { volume24hUsdAt: { sort: "asc", nulls: "first" } },
      select: { mint: true },
      take: VOLUME_REFRESH_LIMIT,
    });
    const mints = [...new Set([...listedOnVolume.map((r) => r.mint), ...discovered])].slice(0, VOLUME_REFRESH_LIMIT);
    const known = new Set((await this.db.marketState.findMany({ where: { mint: { in: mints } }, select: { mint: true } })).map((r) => r.mint));
    const volumes = await new DexScreenerApi(this.config.DEXSCREENER_API_URL).tokenVolumes(mints.filter((m) => known.has(m)));
    const at = new Date();
    // Raw SQL so the row's updatedAt (the price-freshness clock) isn't bumped by a volume-only write.
    for (const [mint, v] of volumes) {
      await this.db.$executeRaw`UPDATE "MarketState" SET "volume24hUsd" = ${new Prisma.Decimal(v.volume24hUsd)}, "volume24hUsdAt" = ${at} WHERE mint = ${mint}`;
    }
  }

  /**
   * SOL/USD from the on-chain Pyth feed (mainnet only), cached for 30 s. A last good price is kept for
   * 6 h so a brief oracle or RPC outage doesn't blank every USD figure. Display and listing only.
   */
  async solUsd(): Promise<string | null> {
    if (!this.config.isMainnet) return null;
    const cached = await this.kv.get("price:sol-usd").catch(() => null);
    if (cached) return cached;
    try {
      const info = await this.connection.getAccountInfo(PYTH_SOL_USD_ACCOUNT);
      const p = decodePythPrice(info, { feedId: PYTH_SOL_USD_FEED_ID, nowSec: Math.floor(Date.now() / 1000), maxAgeSec: 300, maxConfBps: 200 });
      if (p) {
        const value = new D(p.price.toString()).mul(new D(10).pow(p.exponent)).toFixed(4);
        await this.kv.set("price:sol-usd", value, 30).catch(() => {});
        await this.kv.set("price:sol-usd:last", value, 6 * 3600).catch(() => {});
        return value;
      }
      logger.warn("Pyth SOL/USD account missing, stale or too uncertain");
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : e }, "SOL/USD read failed");
    }
    return this.kv.get("price:sol-usd:last").catch(() => null);
  }

  async listingRules(): Promise<ListingRules | null> {
    return listingRules(this.config, await this.solUsd());
  }

  /** E2E fixture tokens exist only in the test database and the in-process test chain. */
  private fixtureDetail(row: NonNullable<Awaited<ReturnType<Db["token"]["findUnique"]>>> & { market: { priceSolPerToken: Prisma.Decimal; marketCapLamports: Prisma.Decimal; liquidityLamports: Prisma.Decimal; bondingProgressBps: number | null; volume24hLamports: Prisma.Decimal; trades24h: number; slot: bigint; updatedAt: Date } | null }): TokenDetail {
    const m = row.market;
    return {
      token: { mint: row.mint, name: row.name, symbol: row.symbol, imageUrl: row.imageUrl, decimals: row.decimals, tokenProgram: row.tokenProgram, creator: row.creator, createdAt: row.createdAt.toISOString(), launchedViaPlatform: false },
      metadata: { description: "End-to-end test fixture.", website: null, twitter: null, telegram: null, uri: null, verifiedOnChain: false },
      market: {
        mint: row.mint, venue: row.venue, note: "Test fixture: this token exists only on the in-process test chain.", tradable: false, tokenProgram: row.tokenProgram, decimals: row.decimals, supply: "1000000000000000",
        priceSolPerToken: m?.priceSolPerToken.toFixed() ?? "0", marketCapLamports: m?.marketCapLamports.toFixed(0) ?? "0", liquidityLamports: m?.liquidityLamports.toFixed(0) ?? "0", progressBps: m?.bondingProgressBps ?? null,
        bondingCurve: null, pool: null, slot: Number(m?.slot ?? 0), fetchedAt: (m?.updatedAt ?? new Date()).toISOString(),
      },
      safety: { ok: true, blockers: [], warnings: [], extensions: [], freezeAuthority: null, mintAuthority: null, transferFeeBps: null },
      stats: { volume24hLamports: m?.volume24hLamports.toFixed(0) ?? "0", volume24hUsd: null, trades24h: m?.trades24h ?? 0, holderCount: null },
    };
  }

  /** Top holders via getTokenLargestAccounts (cheap, bounded). */
  async topHolders(mint: string): Promise<Array<{ address: string; amountRaw: string }>> {
    if ((await this.db.token.findUnique({ where: { mint }, select: { isDemo: true } }))?.isDemo) return [];
    const cached = await this.kv.get(`holders:${mint}`);
    if (cached) return JSON.parse(cached) as Array<{ address: string; amountRaw: string }>;
    const res = await this.connection.getTokenLargestAccounts(new PublicKey(mint));
    const out = res.value.map((a) => ({ address: a.address.toBase58(), amountRaw: a.amount }));
    await this.kv.set(`holders:${mint}`, JSON.stringify(out), 60);
    return out;
  }
}
