import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { AnyPayload } from "./schema";

/**
 * Canonical JSON (see docs/otc-protocol.md §3):
 *  • object keys sorted by UTF-16 code unit order (Array.prototype.sort default),
 *  • no insignificant whitespace,
 *  • strings serialised with JSON.stringify escaping,
 *  • numbers must be safe integers (amounts are always decimal strings),
 *  • `undefined`, NaN, Infinity, floats, and non-plain objects are rejected.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new Error(`canonicalJson: non-integer or unsafe number ${value}`);
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new Error("canonicalJson: only plain objects are allowed");
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [k, v] of entries) if (v === undefined) throw new Error(`canonicalJson: undefined value at ${k}`);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256HexOfString(s: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(s)));
}

/** orderHash / acceptHash / cancelHash = hex(sha256(utf8(canonicalJson(payload)))) */
export function hashPayload(payload: AnyPayload): string {
  return sha256HexOfString(canonicalJson(payload));
}

export function randomHex16(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
