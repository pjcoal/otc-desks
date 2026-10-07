import { z } from "zod";
import { AppError } from "@app/shared";
import { RATE_LIMITS, getKv, getServerConfig } from "@app/shared/server";
import { issuedMetadataKey, type IssuedMetadata } from "@/server/launch";
import { route } from "@/server/http";
import { sanitizeImage } from "@/server/images";
import { putObject } from "@/server/storage";

const url = z.union([z.literal(""), z.url().max(200).refine((u) => /^https?:\/\//.test(u), "must be http(s)")]).optional();
const fields = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9$_.-]+$/, "letters, digits and $ _ . - only"),
  description: z.string().trim().max(1000).default(""),
  website: url,
  twitter: url,
  telegram: url,
});

/**
 * POST /api/launch/metadata (multipart) — upload image + Pump-style metadata JSON BEFORE creating the token.
 * Every launch links back to this site: `createdOn` is the site, the description ends with a
 * "Launched on" line, and the site is the website when the creator leaves it blank. The URI is
 * recorded for this wallet, name and symbol; /api/launch/prepare accepts only recorded URIs.
 */
export const POST = route({ auth: "required", rateLimit: RATE_LIMITS.upload }, async ({ req, wallet }) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new AppError("VALIDATION", "Expected multipart form data.");
  const f = fields.parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  const file = form.get("image");
  if (!(file instanceof File)) throw new AppError("VALIDATION", "An image is required.");
  const image = await putObject(await sanitizeImage(new Uint8Array(await file.arrayBuffer())), "webp", "image/webp", "image");
  const link = getServerConfig().launchLinkUrl;
  const credit = `Launched on ${link}`;
  const metadata = {
    name: f.name,
    symbol: f.symbol,
    description: f.description ? `${f.description}\n\n${credit}` : credit,
    image: image.url,
    showName: true,
    createdOn: link,
    website: f.website || link,
    ...(f.twitter ? { twitter: f.twitter } : {}),
    ...(f.telegram ? { telegram: f.telegram } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  const stored = await putObject(bytes, "json", "application/json", "metadata");
  if (stored.url.length > 200) throw new AppError("METADATA_UNAVAILABLE", "Metadata URI is longer than Pump allows (200 chars).");
  const issued: IssuedMetadata = { wallet: wallet!, name: f.name, symbol: f.symbol };
  await getKv().set(issuedMetadataKey(stored.url), JSON.stringify(issued), 24 * 3600);
  return { uri: stored.url, image: image.url, metadata, uploadedBy: wallet };
});
