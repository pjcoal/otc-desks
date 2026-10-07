import "server-only";
import { PublicKey } from "@solana/web3.js";
import { getDb, dec } from "@app/database";
import type { ServerConfig } from "@app/shared/server";
import type { ChainGateway } from "@app/otc/server";

/**
 * END-TO-END TEST MODE ONLY. With E2E_LITESVM=1 the OTC chain gateway is an in-process LiteSVM
 * (real SPL Token / Token-2022 / System programs) seeded with a test mint and funded test wallets,
 * so Playwright can drive the full offer → accept → dual-sign → settle → receipt journey.
 * Refuses to activate unless SOLANA_CLUSTER=localnet, which can never be mainnet.
 */
export const e2eEnabled = () => process.env.E2E_LITESVM === "1";

interface Fixture {
  chain: ChainGateway;
  mint: string;
  seller: string;
  buyer: string;
}

const g = globalThis as unknown as { __e2e?: Promise<Fixture> };

export function e2eFixture(config: ServerConfig): Promise<Fixture> {
  if (config.SOLANA_CLUSTER !== "localnet" || config.isMainnet) throw new Error("E2E_LITESVM is only allowed with SOLANA_CLUSTER=localnet");
  g.__e2e ??= (async () => {
    const { LiteSvmGateway } = await import("@app/otc/testing");
    const chain = new LiteSvmGateway();
    const seller = new PublicKey(process.env.E2E_SELLER!);
    const buyer = new PublicKey(process.env.E2E_BUYER!);
    for (const w of [seller, buyer]) chain.airdrop(w, 100_000_000_000n);
    if (config.PLATFORM_TREASURY_WALLET) chain.airdrop(new PublicKey(config.PLATFORM_TREASURY_WALLET), 1_000_000_000n);
    const m = chain.createMint({ decimals: 6 });
    chain.mintTo(m, seller, 50_000_000_000_000n);
    const mint = m.mint.toBase58();
    const db = getDb();
    await db.token.upsert({
      where: { mint },
      create: { mint, tokenProgram: m.programId.toBase58(), decimals: 6, name: "[E2E] Test Token", symbol: "E2E", venue: "PUMP_BONDING_CURVE", isDemo: true },
      update: {},
    });
    await db.marketState.upsert({
      where: { mint },
      create: { mint, venue: "PUMP_BONDING_CURVE", priceSolPerToken: "0.000002", marketCapLamports: dec(2_000_000_000_000n), liquidityLamports: dec(10_000_000_000n), bondingProgressBps: 3000, slot: 1n },
      update: {},
    });
    return { chain, mint, seller: seller.toBase58(), buyer: buyer.toBase58() };
  })();
  return g.__e2e;
}

/** A ChainGateway that resolves the LiteSVM fixture lazily (otcContext() is synchronous). */
export function lazyE2EChain(config: ServerConfig): ChainGateway {
  const get = () => e2eFixture(config).then((f) => f.chain);
  return {
    getMint: async (...a) => (await get()).getMint(...a),
    getAccounts: async (...a) => (await get()).getAccounts(...a),
    getRentExemptMinimum: async (...a) => (await get()).getRentExemptMinimum(...a),
    getLatestBlockhash: async () => (await get()).getLatestBlockhash(),
    getBlockHeight: async () => (await get()).getBlockHeight(),
    simulate: async (...a) => (await get()).simulate(...a),
    send: async (...a) => (await get()).send(...a),
    getSignatureState: async (...a) => (await get()).getSignatureState(...a),
    getTransaction: async (...a) => (await get()).getTransaction(...a),
  };
}
