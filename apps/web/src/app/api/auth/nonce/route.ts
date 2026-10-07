import { z } from "zod";
import { buildSignInMessage } from "@app/auth";
import { generateNonce } from "@app/auth/server";
import { getDb } from "@app/database";
import { RATE_LIMITS } from "@app/shared/server";
import { body, route } from "@/server/http";
import { zAddress } from "@/server/schemas";
import { signInFieldsFor } from "@/server/siws";

const NONCE_TTL_MS = 5 * 60 * 1000;

/** POST /api/auth/nonce — server-generated, single-use, wallet-bound, 5-minute nonce. */
export const POST = route({ rateLimit: RATE_LIMITS.authNonce }, async ({ req }) => {
  const { wallet } = await body(req, z.object({ wallet: zAddress }));
  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
  await getDb().nonce.create({ data: { value: nonce, purpose: "SIGN_IN", walletAddress: wallet, createdAt: issuedAt, expiresAt } });
  return { nonce, message: buildSignInMessage(signInFieldsFor(wallet, nonce, issuedAt, expiresAt)), expiresAt: expiresAt.toISOString() };
});
