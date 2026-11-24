import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { MediaValidationError, validateMediaFile } from "../src/modules/media/validation.js";

async function fixture(bytes: Buffer): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "petcare-media-test-"));
  const path = join(directory, "fixture");
  await writeFile(path, bytes);
  return { directory, path };
}

test("media validation accepts real decodable JPEG, PNG and WebP files", async () => {
  for (const [mime, extension] of [["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]] as const) {
    const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#456789" } }).toFormat(extension.slice(1) as "jpeg" | "png" | "webp").toBuffer();
    const item = await fixture(bytes);
    try { assert.equal((await validateMediaFile(item.path, "pet_photo", mime, `animal${extension}`, bytes.length)).mimeType, mime); }
    finally { await rm(item.directory, { recursive: true, force: true }); }
  }
});

test("media validation rejects corrupt, truncated, mislabeled and polyglot images", async () => {
  const valid = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  const inputs = [Buffer.from("not an image"), valid.subarray(0, valid.length - 8), Buffer.concat([valid, Buffer.from("<script>bad()</script>")])];
  for (const bytes of inputs) {
    const item = await fixture(bytes);
    try { await assert.rejects(validateMediaFile(item.path, "pet_photo", "image/png", "cat.png", bytes.length), MediaValidationError); }
    finally { await rm(item.directory, { recursive: true, force: true }); }
  }
  const item = await fixture(valid);
  try { await assert.rejects(validateMediaFile(item.path, "pet_photo", "image/jpeg", "cat.jpg", valid.length), MediaValidationError); }
  finally { await rm(item.directory, { recursive: true, force: true }); }
});

test("media validation enforces decoded pixel and byte limits", async () => {
  const tooManyPixels = await sharp({ create: { width: 4_100, height: 4_000, channels: 3, background: "black" } }).png().toBuffer();
  const largeImage = await fixture(tooManyPixels);
  try { await assert.rejects(validateMediaFile(largeImage.path, "pet_photo", "image/png", "large.png", tooManyPixels.length), MediaValidationError); }
  finally { await rm(largeImage.directory, { recursive: true, force: true }); }

  const tooLargeDocument = Buffer.alloc(15 * 1024 * 1024 + 1, 65);
  const largeDoc = await fixture(tooLargeDocument);
  try { await assert.rejects(validateMediaFile(largeDoc.path, "health_attachment", "text/plain", "large.txt", tooLargeDocument.length), MediaValidationError); }
  finally { await rm(largeDoc.directory, { recursive: true, force: true }); }
});

test("media validation rejects unsupported formats and invalid text encoding", async () => {
  const bytes = Buffer.from([0xff, 0x00, 0xff]);
  const item = await fixture(bytes);
  try { await assert.rejects(validateMediaFile(item.path, "health_attachment", "text/plain", "bad.txt", bytes.length), MediaValidationError); }
  finally { await rm(item.directory, { recursive: true, force: true }); }
  await assert.rejects(validateMediaFile("missing", "health_attachment", "application/octet-stream", "file.bin", 10), MediaValidationError);
  const fakePdf = await fixture(Buffer.from("%PDF-1.7\nnot a document\n%%EOF\n"));
  try { await assert.rejects(validateMediaFile(fakePdf.path, "health_attachment", "application/pdf", "fake.pdf", (await stat(fakePdf.path)).size), MediaValidationError); }
  finally { await rm(fakePdf.directory, { recursive: true, force: true }); }
});
