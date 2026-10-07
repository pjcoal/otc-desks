import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { AppError } from "@app/shared";
import { getDb } from "@app/database";
import { pumpTradeFees } from "@app/pump";
import { route, body } from "@/server/http";
import { registry } from "@/server/context";
import { prepareUserTransaction, serializeQuote } from "@/server/tx";
import { zAddress, zSlippageBps, zU64 } from "@/server/schemas";

/**
 * POST /api/trade/prepare — build an unsigned Pump/PumpSwap buy or sell for the signed-in wallet.
 * The client independently decodes and checks the transaction (verifyTradeMessage) before signing.
 * Slippage is exactly what the user chose; it is never adjusted server-side.
 */
export const POST = route({ auth: "required", transactional: true }, async ({ req, wallet }) => {
  const input = await body(req, z.object({ side: z.enum(["BUY", "SELL"]), mint: zAddress, amount: zU64, slippageBps: zSlippageBps }));
  if (BigInt(input.amount) <= 0n) throw new AppError("VALIDATION", "Amount must be greater than zero.");
  const user = new PublicKey(wallet!);
  const pump = registry().pump;
  const built = input.side === "BUY" ? await pump.buildBuy(input.mint, user, BigInt(input.amount), input.slippageBps) : await pump.buildSell(input.mint, user, BigInt(input.amount), input.slippageBps);
  const tx = await prepareUserTransaction(user, built.instructions, built.computeUnits);
  const market = await pump.getMarket(input.mint);
  await getDb().auditEvent.create({ data: { actor: wallet!, action: `trade.prepared.${input.side.toLowerCase()}`, entityType: "Token", entityId: input.mint, data: { messageHash: tx.messageHash, slippageBps: input.slippageBps } } });
  return { ...tx, quote: serializeQuote(built.quote), fees: pumpTradeFees(market, built.quote).map(serializeQuote) };
});
