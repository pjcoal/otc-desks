import { getDb } from "@app/database";
import { getSignatureState } from "@app/solana";
import { getRpc } from "@app/solana/server";
import { route } from "@/server/http";
import { zSignature } from "@/server/schemas";

/** GET /api/tx/:signature — confirmation status straight from the chain. */
export const GET = route<{ signature: string }>({ auth: "optional" }, async ({ params }) => {
  const sig = zSignature.parse(params.signature);
  const s = await getSignatureState(getRpc().freshConnection, sig);
  if (s.state === "confirmed" || s.state === "finalized" || s.state === "failed") {
    await getDb().transactionRecord.updateMany({ where: { signature: sig }, data: { status: s.state === "failed" ? "FAILED" : s.state === "finalized" ? "FINALIZED" : "CONFIRMED", ...(s.slot ? { slot: BigInt(s.slot) } : {}) } });
  }
  return { signature: sig, ...s, err: s.err ? JSON.stringify(s.err) : null };
});
