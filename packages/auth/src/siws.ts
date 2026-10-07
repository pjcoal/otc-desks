/**
 * Sign-In With Solana message (CAIP-122 / EIP-4361 shape adapted for Solana).
 *
 * The server generates and stores every field; the client signs the exact string the server returns;
 * on verify the server rebuilds the string from its own stored fields (never from client input) and
 * checks the ed25519 signature against the claimed address.
 */
export interface SignInFields {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: "1";
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

export function buildSignInMessage(f: SignInFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    "",
    f.statement,
    "",
    `URI: ${f.uri}`,
    `Version: ${f.version}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

export const SIGN_IN_STATEMENT =
  "Sign in to prove you control this wallet. This request will not trigger a blockchain transaction or cost any fees.";
