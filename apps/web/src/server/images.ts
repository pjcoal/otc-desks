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
