import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { buildSignInMessage, verifyWalletSignature } from "@app/auth";
import { getDb } from "@app/database";
import { AppError } from "@app/shared";
import { RATE_LIMITS } from "@app/shared/server";
import { body, route } from "@/server/http";
import { createSession, isAdmin } from "@/server/session";
import { zAddress, zSignature } from "@/server/schemas";
import { signInFieldsFor } from "@/server/siws";

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newReferralCode = () => Array.from(randomBytes(8), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");

/** POST /api/auth/verify — consume the nonce, verify the ed25519 signature, open a session. */
export const POST = route({ rateLimit: RATE_LIMITS.authVerify }, async ({ req, ip }) => {
  const input = await body(req, z.object({ wallet: zAddress, nonce: z.string().min(16).max(64), signature: zSignature }));
  const db = getDb();
  const n = await db.nonce.findUnique({ where: { value: input.nonce } });
  if (!n || n.purpose !== "SIGN_IN" || n.walletAddress !== input.wallet || n.usedAt || n.expiresAt.getTime() <= Date.now()) throw new AppError("NONCE_INVALID");
  // Consume BEFORE verifying: a nonce can be tried exactly once, so signatures cannot be ground against it.
  const consumed = await db.nonce.updateMany({ where: { value: n.value, usedAt: null }, data: { usedAt: new Date() } });
  if (consumed.count !== 1) throw new AppError("NONCE_INVALID");
  const message = buildSignInMessage(signInFieldsFor(input.wallet, n.value, n.createdAt, n.expiresAt));
  if (!verifyWalletSignature(message, input.signature, input.wallet)) throw new AppError("SIGNATURE_INVALID");

  let wallet = await db.wallet.findUnique({ where: { address: input.wallet }, include: { user: true } });
  if (!wallet) {
    const user = await db.user.create({ data: { referralCode: newReferralCode(), wallets: { create: { address: input.wallet } } } });
    wallet = await db.wallet.findUniqueOrThrow({ where: { address: input.wallet }, include: { user: true } });
    void user;
  } else {
    await db.wallet.update({ where: { address: input.wallet }, data: { lastSeenAt: new Date() } });
  }

  // Referral attribution (first one wins; self-referral ignored).
  const ref = (await cookies()).get("ref")?.value;
  if (ref) {
    const referrer = await db.user.findUnique({ where: { referralCode: ref }, include: { wallets: { take: 1, orderBy: { createdAt: "asc" } } } });
    const referrerWallet = referrer?.wallets[0]?.address;
    if (referrerWallet && referrerWallet !== input.wallet) {
      await db.referralAttribution.upsert({ where: { wallet: input.wallet }, create: { wallet: input.wallet, referrerWallet, code: ref }, update: {} });
    }
  }

  const session = await createSession(input.wallet, { ip, userAgent: req.headers.get("user-agent") });
  await db.auditEvent.create({ data: { actor: input.wallet, action: "auth.sign_in", entityType: "Session", entityId: session.id, ip } });
  return { wallet: input.wallet, referralCode: wallet.user.referralCode, isAdmin: isAdmin(input.wallet), expiresAt: session.expiresAt.toISOString() };
});
