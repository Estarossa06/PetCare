import sharp from "sharp";

const MAX_IMAGE_BYTES = 1_200_000;
const MAX_WIDTH = 6_000;
const MAX_HEIGHT = 6_000;
const MAX_PIXELS = 8_000_000;
const MAX_DECODED_RASTER_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 750_000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FORMAT_FOR_MIME = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" } as const;
const ALLOWED_PNG_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "bKGD", "hIST", "pHYs", "eXIf"]);

sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 10 });

export type SupportedPetImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
};

let decoding = false;

function invalidImage(): Error & { statusCode: number; code: string } {
  return Object.assign(new Error("La imagen está corrupta, manipulada, supera los límites o usa un formato no admitido."), { statusCode: 400, code: "INVALID_IMAGE" });
}

function parseImageRequest(value: unknown): { mimeType: SupportedPetImage["mimeType"]; bytes: Buffer } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidImage();
  const image = value as Record<string, unknown>;
  if (typeof image.mimeType !== "string" || !ALLOWED_MIME_TYPES.has(image.mimeType) || typeof image.data !== "string") throw invalidImage();
  const maxEncodedLength = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
  if (image.data.length === 0 || image.data.length > maxEncodedLength || image.data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) throw invalidImage();
  const bytes = Buffer.from(image.data, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== image.data) throw invalidImage();
  return { mimeType: image.mimeType as SupportedPetImage["mimeType"], bytes };
}

function jpegHasExactEnd(bytes: Buffer): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9) return offset === bytes.length;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    offset += segmentLength;
    if (marker !== 0xda) continue;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      if (offset >= bytes.length) return false;
      let next = bytes[offset++];
      while (next === 0xff && offset < bytes.length) next = bytes[offset++];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) continue;
      if (next === 0xd9) return offset === bytes.length;
      offset -= 2;
      break;
    }
  }
  return false;
}

function pngHasExactEnd(bytes: Buffer): boolean {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 20 || !bytes.subarray(0, 8).equals(signature)) return false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_IMAGE_BYTES || offset + 12 + length > bytes.length) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!ALLOWED_PNG_CHUNKS.has(type)) return false;
    offset += 12 + length;
    if (type === "IEND") return length === 0 && offset === bytes.length;
  }
  return false;
}

function webpHasExactEnd(bytes: Buffer): boolean {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (length > MAX_IMAGE_BYTES || offset + 8 + length > bytes.length) return false;
    if (!["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "EXIF"].includes(chunk)) return false;
    offset += 8 + length + (length % 2);
  }
  return offset === bytes.length;
}

function hasExactContainerEnd(mimeType: SupportedPetImage["mimeType"], bytes: Buffer): boolean {
  if (mimeType === "image/jpeg") return jpegHasExactEnd(bytes);
  if (mimeType === "image/png") return pngHasExactEnd(bytes);
  return webpHasExactEnd(bytes);
}

export async function validateAndNormalizePetImage(value: unknown): Promise<SupportedPetImage> {
  const { mimeType, bytes } = parseImageRequest(value);
  if (!hasExactContainerEnd(mimeType, bytes)) throw invalidImage();
  if (decoding) throw Object.assign(new Error("El servicio de imágenes está ocupado. Inténtalo de nuevo."), { statusCode: 503, code: "IMAGE_DECODER_BUSY" });
  decoding = true;
  try {
    const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_PIXELS, sequentialRead: true, pages: 1 });
    const metadata = await decoder.metadata();
    const decodedRasterBytes = (metadata.width ?? 0) * (metadata.height ?? 0) * Math.min(metadata.channels ?? 4, 4);
    if (metadata.format !== FORMAT_FOR_MIME[mimeType] || !metadata.width || !metadata.height || metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT || metadata.width * metadata.height > MAX_PIXELS || decodedRasterBytes > MAX_DECODED_RASTER_BYTES || (metadata.pages ?? 1) !== 1) throw invalidImage();
    const normalized = await decoder.rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80, chromaSubsampling: "4:2:0" }).toBuffer();
    if (!normalized.length || normalized.length > MAX_OUTPUT_BYTES) throw invalidImage();
    return { mimeType: "image/jpeg", data: normalized.toString("base64") };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    throw invalidImage();
  } finally {
    decoding = false;
  }
}
