import { getDb } from "@app/database";
import { route } from "@/server/http";
import { isAdmin } from "@/server/session";

export const GET = route({ auth: "optional" }, async ({ session }) => {
  if (!session) return { wallet: null };
  const w = await getDb().wallet.findUnique({ where: { address: session.wallet }, include: { user: true } });
  return { wallet: session.wallet, referralCode: w?.user.referralCode ?? null, isAdmin: isAdmin(session.wallet), expiresAt: session.expiresAt.toISOString() };
});
