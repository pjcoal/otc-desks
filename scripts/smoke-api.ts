/**
 * API smoke test against a running app: SIWS sign-in with a throwaway keypair, then prepare a Pump buy.
 * With an unfunded wallet the simulation must fail with a decoded, specific reason.
 *   APP=http://localhost:3000 MINT=<pump mint> npx tsx scripts/smoke-api.ts
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

const APP = process.env.APP ?? "http://localhost:3000";
const MINT = process.env.MINT!;
const kp = Keypair.generate();
const wallet = kp.publicKey.toBase58();
let cookie = "";
async function call(path: string, body?: unknown) {
  const res = await fetch(APP + path, {
    method: body ? "POST" : "GET",
    headers: { origin: APP, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0]!;
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const n = await call("/api/auth/nonce", { wallet });
console.log("nonce", n.status);
const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.json.message as string), kp.secretKey));
console.log("verify", (await call("/api/auth/verify", { wallet, nonce: n.json.nonce, signature: sig })).status);
console.log("replay nonce →", (await call("/api/auth/verify", { wallet, nonce: n.json.nonce, signature: sig })).json);
console.log("session", (await call("/api/auth/session")).json);
const bad = await fetch(APP + "/api/otc/orders", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json", cookie }, body: "{}" });
console.log("cross-origin POST →", bad.status, await bad.text());
const prep = await call("/api/trade/prepare", { side: "BUY", mint: MINT, amount: "10000000", slippageBps: 100 });
console.log("prepare buy (unfunded) →", prep.status, JSON.stringify(prep.json).slice(0, 300));
