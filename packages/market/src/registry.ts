import { PublicKey, type Connection } from "@solana/web3.js";
import { AppError, D, decimalToDbString } from "@app/shared";
import { logger, type KeyValueStore, type ServerConfig } from "@app/shared/server";
import { dec, Prisma, type Db, type MarketVenue } from "@app/database";
import { inspectMintAccount, type MintInspection } from "@app/solana";
import { PumpAdapter, type MarketSnapshot } from "@app/pump";
import type { MarketReader, ReferencePrice, TokenInfo } from "@app/otc/server";
import { sanitizeMetadata } from "./metadata";
import { safeFetchJson, type Gateways } from "./safe-fetch";

const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const TOKEN_REFRESH_MS = 6 * 60 * 60 * 1000;
const MARKET_FRESH_MS = 15_000;

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
    isDemo: boolean;
  };
  metadata: { description: string | null; website: string | null; twitter: string | null; telegram: string | null; uri: string | null; verifiedOnChain: boolean } | null;
  market: SerializedSnapshot;
  safety: MintInspection["safety"] & { extensions: string[]; freezeAuthority: string | null; mintAuthority: string | null; transferFeeBps: number | null };
  stats: { volume24hLamports: string; trades24h: number; holderCount: number | null };
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
      tokenProgram: s.tokenProgram,
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
    if (m && Date.now() - m.updatedAt.getTime() < MARKET_FRESH_MS) return { priceSolPerToken: m.priceSolPerToken.toFixed(), at: m.updatedAt, venue: m.venue };
    try {
      const snap = await this.refreshMarket(mint);
      if (snap.priceSolPerToken === "0") return null;
      return { priceSolPerToken: snap.priceSolPerToken, at: new Date(snap.fetchedAt), venue: snap.venue };
    } catch {
      return m ? { priceSolPerToken: m.priceSolPerToken.toFixed(), at: m.updatedAt, venue: m.venue } : null;
    }
  }

  async tokenDetail(mint: string): Promise<TokenDetail> {
    const demo = await this.db.token.findUnique({ where: { mint }, include: { metadata: true, market: true } });
    if (demo?.isDemo) {
      if (!this.config.DEMO_MODE) throw new AppError("NOT_FOUND", "Mint not found.");
      return this.demoDetail(demo);
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
        isDemo: row.isDemo,
      },
      metadata: row.metadata
        ? { description: row.metadata.description, website: row.metadata.website, twitter: row.metadata.twitter, telegram: row.metadata.telegram, uri: row.metadata.uri, verifiedOnChain: insp.onChainMetadata?.uri === row.metadata.uri }
        : null,
      market: serializeSnapshot(snap),
      safety: { ...insp.safety, extensions: insp.extensions, freezeAuthority: insp.freezeAuthority, mintAuthority: insp.mintAuthority, transferFeeBps: insp.transferFee?.basisPoints ?? null },
      stats: { volume24hLamports: row.market?.volume24hLamports.toFixed() ?? "0", trades24h: row.market?.trades24h ?? 0, holderCount: row.market?.holderCount ?? null },
    };
  }

  /** Demo tokens exist only in the database (DEMO_MODE); never call the chain for them. */
  private demoDetail(row: NonNullable<Awaited<ReturnType<Db["token"]["findUnique"]>>> & { market: { priceSolPerToken: Prisma.Decimal; marketCapLamports: Prisma.Decimal; liquidityLamports: Prisma.Decimal; bondingProgressBps: number | null; volume24hLamports: Prisma.Decimal; trades24h: number; slot: bigint; updatedAt: Date } | null }): TokenDetail {
    const m = row.market;
    return {
      token: { mint: row.mint, name: row.name, symbol: row.symbol, imageUrl: row.imageUrl, decimals: row.decimals, tokenProgram: row.tokenProgram, creator: row.creator, createdAt: row.createdAt.toISOString(), launchedViaPlatform: false, isDemo: true },
      metadata: { description: "Demo token generated for UI development. Not a real market.", website: null, twitter: null, telegram: null, uri: null, verifiedOnChain: false },
      market: {
        mint: row.mint, venue: row.venue, note: "Demo data: this token does not exist on chain.", tradable: false, tokenProgram: row.tokenProgram, decimals: row.decimals, supply: "1000000000000000",
        priceSolPerToken: m?.priceSolPerToken.toFixed() ?? "0", marketCapLamports: m?.marketCapLamports.toFixed(0) ?? "0", liquidityLamports: m?.liquidityLamports.toFixed(0) ?? "0", progressBps: m?.bondingProgressBps ?? null,
        bondingCurve: null, pool: null, slot: Number(m?.slot ?? 0), fetchedAt: (m?.updatedAt ?? new Date()).toISOString(),
      },
      safety: { ok: true, blockers: [], warnings: ["Demo token."], extensions: [], freezeAuthority: null, mintAuthority: null, transferFeeBps: null },
      stats: { volume24hLamports: m?.volume24hLamports.toFixed(0) ?? "0", trades24h: m?.trades24h ?? 0, holderCount: null },
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
