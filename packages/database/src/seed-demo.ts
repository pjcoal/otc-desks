/**
 * DEMO DATA for UI development only.
 *  • Every row is flagged isDemo=true and token names start with "[DEMO]".
 *  • Demo rows are hidden unless DEMO_MODE=true, which the config refuses on mainnet.
 *  • Demo mints do not exist on chain; demo trades and orders are not market activity.
 *   npm run db:seed-demo           (add  -- --clear  to remove all demo rows)
 */
import { randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { buildOrderMessage, hashPayload, newOrderPayload, orderUnitPrice } from "@app/otc";
import { decimalToDbString } from "@app/shared";
import { loadServerConfig } from "@app/shared/server";
import { createPrismaClient, dec, Prisma } from "./index";

const db = createPrismaClient(process.env.DATABASE_URL);
const config = loadServerConfig();
if (config.isMainnet) throw new Error("Refusing to seed demo data against a mainnet configuration.");

async function clear() {
  await db.otcOrderSignature.deleteMany({ where: { order: { isDemo: true } } });
  await db.otcOrder.deleteMany({ where: { isDemo: true } });
  await db.trade.deleteMany({ where: { isDemo: true } });
  await db.token.deleteMany({ where: { isDemo: true } });
}

const TOKENS = [
  ["Harbor Lights", "HRBR"],
  ["Copper Kettle", "KTTL"],
  ["Night Ferry", "FERRY"],
  ["Paper Crane", "CRANE"],
  ["Salt Marsh", "MARSH"],
  ["Lantern Fish", "LNTRN"],
] as const;

async function seed() {
  await clear();
  if (process.argv.includes("--clear")) return console.log("Demo data removed.");
  const domain = { environment: new URL(config.APP_URL).host, network: config.SOLANA_CLUSTER, genesisHash: config.genesisHash };
  const now = Date.now();
  for (const [i, [name, symbol]] of TOKENS.entries()) {
    const mint = Keypair.generate().publicKey.toBase58();
    const creator = Keypair.generate();
    const graduated = i === 5;
    let price = 0.0000000281 * (1 + i * 0.6); // SOL per token, display seed only
    await db.token.create({
      data: { mint, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", decimals: 6, name: `[DEMO] ${name}`, symbol, creator: creator.publicKey.toBase58(), venue: graduated ? "PUMPSWAP" : "PUMP_BONDING_CURVE", complete: graduated, graduatedAt: graduated ? new Date(now - 3_600_000) : null, isDemo: true, createdAt: new Date(now - (48 - i * 6) * 3_600_000), lastTradeAt: new Date(now - 60_000) },
    });
    const trades = [];
    for (let k = 0; k < 220; k++) {
      price *= 1 + (Math.sin(k / 9 + i) * 0.02 + (Math.random() - 0.47) * 0.04);
      const tokens = BigInt(Math.floor(1_000_000 + Math.random() * 40_000_000)) * 1_000_000n;
      const lamports = BigInt(Math.max(1, Math.floor(Number(tokens) / 1e6 * price * 1e9)));
      trades.push({
        signature: `demo${bs58.encode(randomBytes(32))}`,
        eventIndex: 0,
        mint,
        venue: graduated && k > 180 ? ("PUMPSWAP" as const) : ("PUMP_BONDING_CURVE" as const),
        side: Math.random() > 0.45 ? ("BUY" as const) : ("SELL" as const),
        trader: Keypair.generate().publicKey.toBase58(),
        solAmount: dec(lamports),
        tokenAmount: dec(tokens),
        priceSolPerToken: new Prisma.Decimal(decimalToDbString(orderUnitPrice(lamports, tokens, 6))),
        slot: BigInt(1000 + k),
        blockTime: new Date(now - (220 - k) * 12 * 60_000),
        isDemo: true,
      });
    }
    await db.trade.createMany({ data: trades });
    const last = trades[trades.length - 1]!;
    const vol = trades.filter((t) => t.blockTime.getTime() > now - 86_400_000).reduce((a, t) => a + BigInt(t.solAmount.toFixed()), 0n);
    await db.marketState.create({
      data: { mint, venue: graduated ? "PUMPSWAP" : "PUMP_BONDING_CURVE", priceSolPerToken: last.priceSolPerToken, marketCapLamports: dec(BigInt(Math.floor(Number(last.priceSolPerToken.toFixed()) * 1e9 * 1e9))), liquidityLamports: dec(BigInt((10 + i * 7) * 1e9)), bondingProgressBps: graduated ? 10_000 : 2_000 + i * 1_500, volume24hLamports: dec(vol), trades24h: trades.filter((t) => t.blockTime.getTime() > now - 86_400_000).length, slot: 1220n },
    });

    // Two signed demo orders per token (real signatures by throwaway demo keys).
    for (const side of ["SELL", "BUY"] as const) {
      const maker = Keypair.generate();
      const tokenAmountRaw = BigInt(5 + i * 3) * 1_000_000n * 1_000_000n;
      const ref = Number(last.priceSolPerToken.toFixed());
      const quote = BigInt(Math.floor((Number(tokenAmountRaw) / 1e6) * ref * (side === "SELL" ? 0.9 : 0.85) * 1e9));
      const payload = newOrderPayload(domain, { makerWallet: maker.publicKey.toBase58(), takerWallet: null, tokenMint: mint, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", tokenDecimals: 6, side, tokenAmountRaw, quoteAmountRaw: quote, ttlSeconds: 7 * 86_400, allowPartialFill: side === "SELL", minimumFillAmountRaw: side === "SELL" ? tokenAmountRaw / 4n : tokenAmountRaw, platformFeeBps: config.OTC_PLATFORM_FEE_BPS, feeMode: config.OTC_FEE_MODE, note: "Demo order: not real" });
      const message = buildOrderMessage(payload);
      const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), maker.secretKey));
      await db.otcOrder.create({
        data: {
          id: payload.orderId, publicId: bs58.encode(randomBytes(12)), orderHash: hashPayload(payload), version: 1, environment: payload.environment, network: payload.network, genesisHash: payload.genesisHash,
          makerWallet: payload.makerWallet, takerWallet: null, tokenMint: mint, tokenProgram: payload.tokenProgram, tokenDecimals: 6, side, tokenAmountRaw: dec(tokenAmountRaw), quoteMint: "SOL", quoteAmountRaw: dec(quote),
          priceDecimal: new Prisma.Decimal(decimalToDbString(orderUnitPrice(quote, tokenAmountRaw, 6))), allowPartialFill: payload.allowPartialFill, minimumFillAmountRaw: dec(payload.minimumFillAmountRaw), platformFeeBps: payload.platformFeeBps, feeMode: payload.feeMode, metadataVersion: 1, note: payload.note,
          nonce: payload.nonce, salt: payload.salt, status: "OPEN", signedMessage: message, signature, createdAt: new Date(payload.createdAt * 1000), expiresAt: new Date(payload.expiresAt * 1000), rootOrderId: payload.orderId, revision: 0,
          refPriceSolPerToken: last.priceSolPerToken, refPriceAt: new Date(), isDemo: true,
          signatures: { create: { kind: "ORDER", signer: payload.makerWallet, message, signature, nonce: payload.nonce } },
        },
      });
    }
  }
  console.log(`Seeded ${TOKENS.length} demo tokens with trades and signed demo orders (visible only with DEMO_MODE=true).`);
}

await seed();
await db.$disconnect();
