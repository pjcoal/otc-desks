/**
 * A real Wallet Standard wallet injected into the page, backed by a test seed and WebCrypto Ed25519.
 * The app discovers it exactly like Phantom/Solflare/Backpack, so the production wallet-adapter
 * code paths (connect, signMessage, signTransaction) are what the E2E suite exercises.
 */
export function mockWalletScript(seedHex: string, name: string): string {
  return `(() => {
  const SEED = Uint8Array.from(${JSON.stringify(seedHex)}.match(/../g).map((h) => parseInt(h, 16)));
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58 = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ""; while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b !== 0) break; s = "1" + s; } return s; };
  const pkcs8 = new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20, ...SEED]);
  const keyP = crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const pubP = keyP.then(async (k) => { const jwk = await crypto.subtle.exportKey("jwk", k); const s = jwk.x.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0)); });
  const sign = async (msg) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, await keyP, msg));
  const readCompact = (buf, off) => { let len = 0, size = 0; for (;;) { const b = buf[off + size]; len |= (b & 0x7f) << (7 * size); size++; if ((b & 0x80) === 0) break; } return [len, size]; };
  const listeners = { change: new Set() };
  let account = null;
  const wallet = {
    version: "1.0.0",
    name: ${JSON.stringify(name)},
    icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#93b9ff"/></svg>'),
    chains: ["solana:mainnet", "solana:devnet", "solana:testnet", "solana:localnet"],
    get accounts() { return account ? [account] : []; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => {
        const pk = await pubP;
        account = { address: b58(pk), publicKey: pk, chains: wallet.chains, features: ["solana:signMessage", "solana:signTransaction"] };
        listeners.change.forEach((l) => l({ accounts: wallet.accounts }));
        return { accounts: wallet.accounts };
      } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { account = null; listeners.change.forEach((l) => l({ accounts: [] })); } },
      "standard:events": { version: "1.0.0", on: (ev, l) => { listeners[ev]?.add(l); return () => listeners[ev]?.delete(l); } },
      "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) => Promise.all(inputs.map(async ({ message }) => ({ signedMessage: message, signature: await sign(message) }))) },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...inputs) => Promise.all(inputs.map(async ({ transaction }) => {
        const tx = Uint8Array.from(transaction);
        const [nSigs, sz] = readCompact(tx, 0);
        const msgOff = sz + 64 * nSigs;
        const msg = tx.slice(msgOff);
        let o = (msg[0] & 0x80) ? 1 : 0;
        const required = msg[o];
        o += 3;
        const [nKeys, ksz] = readCompact(msg, o);
        o += ksz;
        const pk = b58(await pubP);
        for (let i = 0; i < Math.min(required, nKeys); i++) {
          if (b58(msg.slice(o + 32 * i, o + 32 * (i + 1))) === pk) tx.set(await sign(msg), sz + 64 * i);
        }
        window.__e2eSigned = (window.__e2eSigned || 0) + 1;
        return { signedTransaction: tx };
      })) },
    },
  };
  const register = ({ register }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register })); } catch {}
})();`;
}
