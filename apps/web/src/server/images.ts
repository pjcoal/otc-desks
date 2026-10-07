import "server-only";
import sharp from "sharp";
import { AppError } from "@app/shared";

const MAX_BYTES = 4 * 1024 * 1024;

/** Accept only real PNG/JPEG/GIF/WebP by magic bytes, then re-encode (strips metadata and any appended payload). */
export async function sanitizeImage(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0 || input.byteLength > MAX_BYTES) throw new AppError("UPLOAD_REJECTED", "Images must be between 1 byte and 4 MB.");
  const b = input;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isGif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (!isPng && !isJpeg && !isGif && !isWebp) throw new AppError("UPLOAD_REJECTED", "Only PNG, JPEG, GIF or WebP images are accepted (SVG is not).");
  try {
    const img = sharp(input, { animated: isGif || isWebp, limitInputPixels: 4096 * 4096 });
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < 32 || meta.height < 32) throw new AppError("UPLOAD_REJECTED", "Image must be at least 32×32 pixels.");
    return new Uint8Array(await img.rotate().resize(512, 512, { fit: "cover", withoutEnlargement: false }).webp({ quality: 88 }).toBuffer());
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("UPLOAD_REJECTED", "The image could not be decoded.");
  }
}

const SNIFF: Array<(b: Uint8Array) => boolean> = [
  (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, // PNG
  (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, // JPEG
  (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46, // GIF
  (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WebP
  (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, // ISO-BMFF (AVIF/HEIF)
];

/**
 * Square WebP thumbnail of an untrusted remote image (first frame only). Raster formats only, checked
 * by magic bytes: SVG and anything else is refused. Returns null when the bytes aren't a usable image.
 */
export async function thumbnail(input: Uint8Array, size: number): Promise<Buffer | null> {
  if (input.byteLength < 12 || !SNIFF.some((f) => f(input))) return null;
  try {
    return await sharp(input, { animated: false, limitInputPixels: 8192 * 8192 }).rotate().resize(size, size, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}
