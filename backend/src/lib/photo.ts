import sharp from "sharp";

export const PHOTO_SIZE = 320;

/**
 * Turns any supported image (JPEG, PNG, WebP, GIF, TIFF, AVIF) into the stored profile photo: square,
 * 320 px, JPEG, rotation applied, EXIF/location data stripped. Throws on anything that isn't a real image.
 */
export function toProfileJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "attention" })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

/** First bytes → format name, for clear messages about photos we can't read (e.g. BMP from HR software). */
export function sniffImage(b: Buffer): string {
  if (b.length < 4) return "empty";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b.subarray(0, 4).toString("hex") === "89504e47") return "png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF") return "webp";
  if (b.subarray(0, 2).toString("latin1") === "BM") return "bmp";
  if (b.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  return `unknown (${b.subarray(0, 4).toString("hex")})`;
}
