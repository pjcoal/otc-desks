import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AppError } from "@app/shared";
import { getServerConfig } from "@app/shared/server";

/**
 * Object storage for token images and metadata JSON.
 *  local  — dev only: files under apps/web/.uploads served by /api/uploads/[file]
 *  s3     — any S3-compatible store (AWS, R2, MinIO); public URL = S3_PUBLIC_BASE_URL/key
 *  pinata — IPFS pinning (METADATA_API_KEY = Pinata JWT); URL = PINATA_GATEWAY_URL + CID (the pinning
 *           provider's own gateway serves our pins most reliably; readers also accept any /ipfs/<cid> URL)
 * Content-addressed names (sha256) make uploads idempotent and immutable.
 */
export interface StoredObject {
  url: string;
  key: string;
}

export const UPLOAD_DIR = join(process.cwd(), ".uploads");

function s3(): S3Client {
  const c = getServerConfig();
  if (!c.S3_ENDPOINT || !c.S3_BUCKET || !c.S3_ACCESS_KEY || !c.S3_SECRET_KEY) throw new AppError("METADATA_UNAVAILABLE", "S3 storage is not configured.");
  return new S3Client({ endpoint: c.S3_ENDPOINT, region: c.S3_REGION, credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY }, forcePathStyle: true });
}

async function putPinata(bytes: Uint8Array, name: string, contentType: string): Promise<string> {
  const c = getServerConfig();
  if (!c.METADATA_API_KEY) throw new AppError("METADATA_UNAVAILABLE", "Pinata JWT (METADATA_API_KEY) is not configured.");
  const form = new FormData();
  form.append("network", "public");
  form.append("file", new Blob([bytes as BlobPart], { type: contentType }), name);
  const res = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${c.METADATA_API_KEY}` }, body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new AppError("METADATA_UNAVAILABLE", `IPFS upload failed (HTTP ${res.status}).`);
  const json = (await res.json()) as { data?: { cid?: string } };
  if (!json.data?.cid) throw new AppError("METADATA_UNAVAILABLE", "IPFS upload returned no CID.");
  return json.data.cid;
}

export async function putObject(bytes: Uint8Array, ext: "webp" | "png" | "json", contentType: string, target: "image" | "metadata"): Promise<StoredObject> {
  const c = getServerConfig();
  const key = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  const provider = target === "image" && c.S3_BUCKET ? "s3" : c.METADATA_PROVIDER;
  if (provider === "s3") {
    await s3().send(new PutObjectCommand({ Bucket: c.S3_BUCKET!, Key: `tokens/${key}`, Body: bytes, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
    const base = c.S3_PUBLIC_BASE_URL ?? `${c.S3_ENDPOINT}/${c.S3_BUCKET}`;
    return { url: `${base.replace(/\/$/, "")}/tokens/${key}`, key };
  }
  if (provider === "pinata") {
    const cid = await putPinata(bytes, key, contentType);
    return { url: `${c.PINATA_GATEWAY_URL.replace(/\/?$/, "/")}${cid}`, key: cid };
  }
  if (c.isMainnet) throw new AppError("METADATA_UNAVAILABLE", "Local storage cannot be used on mainnet.");
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, key), bytes);
  return { url: `${c.APP_URL.replace(/\/$/, "")}/api/uploads/${key}`, key };
}
