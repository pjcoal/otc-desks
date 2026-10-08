import "server-only";
import { SIGN_IN_STATEMENT, siwsChainId } from "@app/auth";
import { getServerConfig } from "@app/shared/server";

export function signInFieldsFor(wallet: string, nonce: string, issuedAt: Date, expiresAt: Date) {
  const c = getServerConfig();
  const url = new URL(c.APP_URL);
  return { domain: url.host, address: wallet, statement: SIGN_IN_STATEMENT, uri: url.origin, version: "1" as const, chainId: siwsChainId(c.SOLANA_CLUSTER), nonce, issuedAt: issuedAt.toISOString(), expirationTime: expiresAt.toISOString() };
}
