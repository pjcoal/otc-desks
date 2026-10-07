import bs58 from "bs58";
import nacl from "tweetnacl";

/**
 * Verify an ed25519 signature produced by a Solana wallet over `message`.
 * Never throws on malformed input — malformed means invalid.
 */
export function verifyWalletSignature(
  message: Uint8Array | string,
  signatureBase58: string,
  publicKeyBase58: string,
): boolean {
  try {
    const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
    const sig = bs58.decode(signatureBase58);
    const pk = bs58.decode(publicKeyBase58);
    if (sig.length !== 64 || pk.length !== 32) return false;
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

export function encodeSignature(sig: Uint8Array): string {
  return bs58.encode(sig);
}
