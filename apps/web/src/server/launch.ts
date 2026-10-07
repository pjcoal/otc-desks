import "server-only";
import { createHash } from "node:crypto";

/** A metadata URI uploaded through /api/launch/metadata, as recorded for /api/launch/prepare. */
export interface IssuedMetadata {
  wallet: string;
  name: string;
  symbol: string;
}

export const issuedMetadataKey = (uri: string) => `launch:meta:${createHash("sha256").update(uri).digest("hex")}`;
