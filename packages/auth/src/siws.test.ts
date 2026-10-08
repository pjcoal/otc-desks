import { describe, expect, it } from "vitest";
import { buildSignInMessage, SIGN_IN_STATEMENT, siwsChainId } from "./siws";

// Chain IDs the SIWS spec (github.com/phantom/sign-in-with-solana) allows. Phantom rejects others.
const SPEC_CHAIN_IDS = ["mainnet", "testnet", "devnet", "localnet", "solana:mainnet", "solana:testnet", "solana:devnet"];

describe("Sign-In With Solana message", () => {
  it("uses spec chain IDs for every cluster", () => {
    for (const c of ["mainnet-beta", "devnet", "testnet"] as const) expect(SPEC_CHAIN_IDS).toContain(siwsChainId(c));
    expect(siwsChainId("mainnet-beta")).toBe("mainnet");
  });
  it("follows the spec field order", () => {
    const m = buildSignInMessage({ domain: "www.desk404.fun", address: "3wP2Puc4QLHaCNUuaeFH8xZhV2UcNTYFmM9sveScg7zv", statement: SIGN_IN_STATEMENT, uri: "https://www.desk404.fun", version: "1", chainId: siwsChainId("mainnet-beta"), nonce: "5qEeeAb2VuRdxSyaeuJKHh", issuedAt: "2026-10-08T00:48:49.466Z", expirationTime: "2026-10-08T00:53:49.466Z" });
    expect(m.split("\n")[0]).toBe("www.desk404.fun wants you to sign in with your Solana account:");
    const keys = m.split("\n").filter((l) => /^[A-Z][A-Za-z ]+: /.test(l)).map((l) => l.split(":")[0]);
    expect(keys).toEqual(["URI", "Version", "Chain ID", "Nonce", "Issued At", "Expiration Time"]);
    expect(m).toContain("Chain ID: mainnet\n");
  });
});
