import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";

export type MediaPurpose = "pet_photo" | "health_attachment";
export type ValidatedMedia = { purpose: MediaPurpose; mimeType: string; filename: string; maxBytes: number };
export class MediaValidationError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) { super(message); }
}

const PHOTO_MAX = 10 * 1024 * 1024;
const DOCUMENT_MAX = 15 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"],
};
const DOCUMENT_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"], "text/plain": [".txt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  ...PHOTO_TYPES,
};
const JPEG_END = Buffer.from([0xff, 0xd9]);

function invalid(): MediaValidationError { return new MediaValidationError("INVALID_MEDIA", "El archivo está dañado o su contenido no coincide con el formato permitido."); }
function has(buffer: Buffer, offset: number, bytes: number[]): boolean { return bytes.every((byte, index) => buffer[offset + index] === byte); }

async function validateImage(mime: string, bytes: Buffer): Promise<void> {
  const format = mime === "image/jpeg" ? "jpeg" : mime === "image/png" ? "png" : "webp";
  if (mime === "image/jpeg" && (bytes[0] !== 0xff || bytes[1] !== 0xd8 || !bytes.subarray(-2).equals(JPEG_END))) throw invalid();
  if (mime === "image/png") {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw invalid();
    const end = bytes.lastIndexOf(Buffer.from("IEND"));
    if (end < 4 || end + 8 !== bytes.length) throw invalid();
  }
  if (mime === "image/webp" && (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length)) throw invalid();
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: 16_000_000, animated: false });
    const meta = await image.metadata();
    if (meta.format !== format || !meta.width || !meta.height || meta.pages && meta.pages !== 1 || meta.width * meta.height > 16_000_000) throw invalid();
    await image.stats();
  } catch { throw invalid(); }
}

function validateDocx(bytes: Buffer): void {
  if (!has(bytes, 0, [0x50,0x4b,0x03,0x04])) throw invalid();
  const start = Math.max(0, bytes.length - 65_557);
  const eocd = bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if (eocd < start || eocd + 22 > bytes.length || eocd + 22 + bytes.readUInt16LE(eocd + 20) !== bytes.length) throw invalid();
  const entries = bytes.readUInt16LE(eocd + 10);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entries < 2 || entries > 2_000 || centralOffset >= eocd) throw invalid();
  let offset = centralOffset;
  const names = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (!has(bytes, offset, [0x50,0x4b,0x01,0x02]) || offset + 46 > eocd) throw invalid();
    const compressed = bytes.readUInt32LE(offset + 20);
    const uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    if (uncompressed > 32 * 1024 * 1024 || (compressed === 0 && uncompressed > 0)) throw invalid();
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name.startsWith("/") || name.split(/[\\/]/).includes("..")) throw invalid();
    names.add(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml") || names.has("word/vbaProject.bin")) throw invalid();
  const contentType = readZipEntry(bytes, centralOffset, "[Content_Types].xml");
  const document = readZipEntry(bytes, centralOffset, "word/document.xml");
  if (!contentType.toString("utf8").includes("wordprocessingml.document.main+xml") || !document.toString("utf8").includes("<w:document") || !document.toString("utf8").includes("</w:document>")) throw invalid();
}

function readZipEntry(bytes: Buffer, centralOffset: number, wanted: string): Buffer {
  let offset = centralOffset;
  while (has(bytes, offset, [0x50,0x4b,0x01,0x02])) {
    const method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32), localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      if (uncompressed > 1_000_000 || localOffset + 30 > bytes.length || !has(bytes, localOffset, [0x50,0x4b,0x03,0x04])) throw invalid();
      const localName = bytes.readUInt16LE(localOffset + 26), localExtra = bytes.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localName + localExtra, compressedData = bytes.subarray(dataStart, dataStart + compressed);
      if (compressedData.length !== compressed) throw invalid();
      if (method === 0) return Buffer.from(compressedData);
      if (method !== 8) throw invalid();
      try { return inflateRawSync(compressedData, { maxOutputLength: 1_000_000 }); } catch { throw invalid(); }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw invalid();
}

export async function validateMediaFile(path: string, purpose: MediaPurpose, mimeType: string, filename: string, size: number): Promise<ValidatedMedia> {
  const allowed = purpose === "pet_photo" ? PHOTO_TYPES : DOCUMENT_TYPES;
  const maxBytes = purpose === "pet_photo" ? PHOTO_MAX : DOCUMENT_MAX;
  const cleanName = filename.normalize("NFC").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180).trim();
  const extension = cleanName.toLowerCase().slice(cleanName.lastIndexOf("."));
  if (!cleanName || size < 1 || size > maxBytes || !allowed[mimeType] || !allowed[mimeType].includes(extension)) throw new MediaValidationError("INVALID_MEDIA_TYPE_OR_SIZE", "El formato o el tamaño del archivo no está permitido.");
  const bytes = await readFile(path);
  if (bytes.length !== size) throw invalid();
  if (mimeType.startsWith("image/")) await validateImage(mimeType, bytes);
  else if (mimeType === "application/pdf") {
    const text = bytes.toString("latin1");
    const startXref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
    if (!/^%PDF-[12]\.\d/.test(text) || !startXref || bytes.includes(0) || !/\/Root\s+\d+\s+\d+\s+R/.test(text) || !/\/Type\s*\/Catalog\b/.test(text) || !/\/Type\s*\/Pages\b/.test(text) || !/\/Type\s*\/Page(?!s)\b/.test(text) || !/\d+\s+\d+\s+obj[\s\S]*?endobj/.test(text)) throw invalid();
    const xrefOffset = Number(startXref[1]);
    const xref = text.slice(xrefOffset, xrefOffset + 2048);
    if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 5 || xrefOffset >= bytes.length || (!/^xref\b/.test(xref) && !/\/Type\s*\/XRef\b/.test(xref))) throw invalid();
  } else if (mimeType === "text/plain") {
    if (bytes.includes(0)) throw invalid();
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw invalid(); }
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") validateDocx(bytes);
  return { purpose, mimeType, filename: cleanName, maxBytes };
}
