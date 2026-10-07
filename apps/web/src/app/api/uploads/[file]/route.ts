import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { AppError } from "@app/shared";
import { route } from "@/server/http";
import { UPLOAD_DIR } from "@/server/storage";

/** Dev-only local object serving (METADATA_PROVIDER=local). Names are content hashes; nothing else is readable. */
export const GET = route<{ file: string }>({}, async ({ params }) => {
  const m = /^([0-9a-f]{64})\.(webp|json)$/.exec(params.file);
  if (!m) throw new AppError("NOT_FOUND");
  const bytes = await readFile(join(UPLOAD_DIR, params.file)).catch(() => null);
  if (!bytes) throw new AppError("NOT_FOUND");
  return new NextResponse(bytes, {
    headers: { "content-type": m[2] === "json" ? "application/json" : "image/webp", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
});
