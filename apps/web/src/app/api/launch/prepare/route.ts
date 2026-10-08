import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { AppError } from "@app/shared";
import { getKv } from "@app/shared/server";
import { route, body } from "@/server/http";
import { getRpc } from "@app/solana/server";
import { formatSol } from "@app/shared";
import { issuedMetadataKey, type IssuedMetadata } from "@/server/launch";
import { registry } from "@/server/context";
import { prepareUserTransaction, serializeQuote } from "@/server/tx";
import { zAddress, zSlippageBps, zU64 } from "@/server/schemas";

/** Measured on mainnet (2026-10-08): rent for Pump's accounts plus the network and priority fee. */
const LAUNCH_COST_LAMPORTS = 5_750_000n;
/** Cost plus the payer's rent-exempt minimum (890,880 lamports) and a small margin. */
const LAUNCH_MIN_BALANCE_LAMPORTS = 7_000_000n;

/**
 * POST /api/launch/prepare — build create_v2 (Token-2022) or create_v2 + atomic first buy.
 * Only the mint PUBLIC key is sent; the mint keypair is generated and kept in the browser.
 */
export const POST = route({ auth: "required", transactional: "launch" }, async ({ req, wallet }) => {
  const input = await body(
    req,
    z.object({
      mint: zAddress,
      name: z.string().trim().min(1).max(32),
      symbol: z.string().trim().min(1).max(10),
      uri: z.url().max(200).refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "metadata URI must be https"),
      initialBuyLamports: zU64.default("0"),
      slippageBps: zSlippageBps.default(100),
      holderReward: z.boolean().default(false),
    }),
  );
  if (input.mint === wallet) throw new AppError("VALIDATION", "Mint must be a fresh keypair.");
  // create_v2 + buy exceeds Solana's 1232-byte transaction limit without an address lookup table.
  if (BigInt(input.initialBuyLamports) > 0n) throw new AppError("VALIDATION", "Create and buy isn't available yet. Launch with Create only, then buy on the coin's page.");
  // Only metadata this site uploaded (which always links back to the site), for this wallet, name and symbol.
  const raw = await getKv().get(issuedMetadataKey(input.uri));
  const issued = raw ? (JSON.parse(raw) as IssuedMetadata) : null;
  if (!issued || issued.wallet !== wallet || issued.name !== input.name || issued.symbol !== input.symbol) {
    throw new AppError("VALIDATION", "Upload the token's image and details on this page first, then launch with the same name and ticker.");
  }
  // A create_v2 launch costs the creator ~0.00575 SOL (Pump account rent + network fee), and the
  // wallet must keep its own rent-exempt minimum. Check up front so people get a clear answer.
  const balance = BigInt(await getRpc().freshConnection.getBalance(new PublicKey(wallet!), "confirmed"));
  if (balance < LAUNCH_MIN_BALANCE_LAMPORTS) {
    throw new AppError("BUYER_INSUFFICIENT_SOL", `Launching costs about ${formatSol(LAUNCH_COST_LAMPORTS, 4)} SOL, and your wallet must keep a small reserve. You need at least ${formatSol(LAUNCH_MIN_BALANCE_LAMPORTS, 4)} SOL; this wallet has ${formatSol(balance, 4)} SOL.`);
  }
  const pump = registry().pump;
  const exists = await pump.getMarket(input.mint).then(() => true, () => false);
  if (exists) throw new AppError("VALIDATION", "That mint address already exists. Generate a new mint keypair.");
  const creator = new PublicKey(wallet!);
  const built = await pump.buildCreate({ mint: new PublicKey(input.mint), creator, name: input.name, symbol: input.symbol, uri: input.uri, initialBuyLamports: BigInt(input.initialBuyLamports), slippageBps: input.slippageBps, holderReward: input.holderReward });
  const tx = await prepareUserTransaction(creator, built.instructions, built.computeUnits, { signers: 2 });
  return {
    ...tx,
    summary: {
      mint: input.mint,
      creator: wallet,
      bondingCurve: built.bondingCurve,
      tokenProgram: "Token-2022",
      instruction: built.initialBuy ? "create_v2 + buy_exact_quote_in_v2 (atomic)" : "create_v2",
      initialBuy: built.initialBuy ? serializeQuote(built.initialBuy) : null,
    },
  };
});
