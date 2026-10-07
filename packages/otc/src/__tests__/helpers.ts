import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { OtcDomain } from "../schema";

export const DOMAIN: OtcDomain = { environment: "localhost:3000", network: "devnet", genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" };

export function signText(kp: Keypair, text: string): string {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));
}

export const kp = () => Keypair.generate();
