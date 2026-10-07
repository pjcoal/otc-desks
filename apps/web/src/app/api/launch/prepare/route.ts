import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { AppError } from "@app/shared";
import { route, body } from "@/server/http";
import { registry } from "@/server/context";
import { prepareUserTransaction, serializeQuote } from "@/server/tx";
import { zAddress, zSlippageBps, zU64 } from "@/server/schemas";

/**
 * POST /api/launch/prepare — build create_v2 (Token-2022) or create_v2 + atomic first buy.
 * Only the mint PUBLIC key is sent; the mint keypair is generated and kept in the browser.
 */
export const POST = route({ auth: "required", transactional: true }, async ({ req, wallet }) => {
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
