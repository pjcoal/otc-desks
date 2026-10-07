import { normaliseUri, type Gateways } from "./safe-fetch";

export interface SanitizedMetadata {
  name: string | null;
  symbol: string | null;
  description: string | null;
  image: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);

function httpUrl(v: unknown): string | null {
  const s = str(v, 512);
  if (!s) return null;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Keep only the fields we render, as plain strings (never HTML). Links must be http(s). */
export function sanitizeMetadata(raw: unknown, gw: Gateways): SanitizedMetadata {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ext = (o.extensions && typeof o.extensions === "object" ? o.extensions : {}) as Record<string, unknown>;
  const image = str(o.image, 512);
  return {
    name: str(o.name, 64),
    symbol: str(o.symbol, 16),
    description: str(o.description, 1000),
    image: image ? normaliseUri(image, gw) : null,
    website: httpUrl(o.website ?? ext.website),
    twitter: httpUrl(o.twitter ?? ext.twitter),
    telegram: httpUrl(o.telegram ?? ext.telegram),
  };
}
