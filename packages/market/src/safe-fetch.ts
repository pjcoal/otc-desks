/**
 * SSRF-hardened fetch for untrusted URLs (token metadata URIs are attacker-controlled).
 *  • only https (plus ipfs:// / ar:// rewritten to configured https gateways)
 *  • every resolved address is checked at CONNECT time (defeats DNS rebinding)
 *  • private, loopback, link-local, CGNAT, multicast and reserved ranges are refused
 *  • manual redirects (≤3), each re-validated; 5 s timeout; 256 KB cap
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export class UnsafeUrlError extends Error {
  override name = "UnsafeUrlError";
}

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return cb(Object.assign(new Error(`Refusing to connect to a private address for ${hostname}`), { code: "EUNSAFE" }), []);
    }
    const all = (options as { all?: boolean }).all;
    if (all) cb(null, list);
    else cb(null, list[0]!.address, list[0]!.family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never, timeout: TIMEOUT_MS }, headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS });

export interface Gateways {
  ipfs: string;
  arweave?: string;
}

/** Normalise a metadata/image URI to https, or return null if it is not allowed. */
export function normaliseUri(uri: string, gw: Gateways): string | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    return /^[A-Za-z0-9._\-/]+$/.test(path) ? `${gw.ipfs.replace(/\/?$/, "/")}${path}` : null;
  }
  if (trimmed.startsWith("ar://")) {
    const id = trimmed.slice(5);
    return /^[A-Za-z0-9_-]+$/.test(id) ? `${(gw.arweave ?? "https://arweave.net/").replace(/\/?$/, "/")}${id}` : null;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (isIP(u.hostname) && isPrivateAddress(u.hostname)) return null;
    if (u.hostname === "localhost" || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function safeFetchJson(rawUrl: string, gw: Gateways): Promise<unknown> {
  const first = normaliseUri(rawUrl, gw);
  if (!first) throw new UnsafeUrlError("URL scheme or host not allowed");
  let url: string = first;
  for (let hop = 0; hop < 4; hop++) {
    const res = await undiciFetch(url, { dispatcher: agent, redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      const next: string | null = loc ? normaliseUri(new URL(loc, url).toString(), gw) : null;
      if (!next) throw new UnsafeUrlError("Redirect target not allowed");
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("Metadata too large");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Metadata too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  throw new UnsafeUrlError("Too many redirects");
}
