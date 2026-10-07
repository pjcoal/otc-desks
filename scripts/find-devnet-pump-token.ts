/** Dev helper: decode recent Pump program transactions on the configured cluster and print mints seen. */
import { Connection } from "@solana/web3.js";
import { eventsFromTransaction, PUMP_PROGRAM_ID } from "@app/pump";

const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const sigs = await conn.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit: Number(process.env.LIMIT ?? 25) });
const seen = new Map<string, string[]>();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const s of sigs) {
  if (s.err) continue;
  await pause(Number(process.env.THROTTLE_MS ?? 800)); // public RPCs rate-limit getTransaction
  const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx) continue;
  for (const e of eventsFromTransaction(tx)) {
    const mint = "mint" in e ? e.mint : "baseMint" in e ? e.baseMint : null;
    if (mint) seen.set(mint, [...(seen.get(mint) ?? []), e.kind]);
  }
}
for (const [mint, kinds] of seen) console.log(mint, kinds.join(","));
