import assert from "node:assert/strict";
import test from "node:test";
import { loadPetVisionConfig } from "../src/modules/pet-identification/config.js";
import sharp from "sharp";
import { validateAndNormalizePetImage } from "../src/modules/pet-identification/imageValidation.js";
import { OllamaPetVisionProvider } from "../src/modules/pet-identification/ollamaVisionProvider.js";
import { createApp } from "../src/app.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

test("vision provider configuration is loopback-only and validates timeout", () => {
  assert.deepEqual(loadPetVisionConfig({}), { baseUrl: "http://127.0.0.1:11434", model: "qwen2.5vl:7b", timeoutMs: 90_000 });
  assert.throws(() => loadPetVisionConfig({ PET_VISION_OLLAMA_BASE_URL: "https://example.com" }));
  assert.throws(() => loadPetVisionConfig({ PET_VISION_OLLAMA_BASE_URL: "http://10.0.0.2:11434" }));
  assert.throws(() => loadPetVisionConfig({ PET_VISION_TIMEOUT_MS: "0" }));
});

test("real decoder accepts supported photos and passes only normalized, metadata-free JPEG", async () => {
  const source = sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 18, g: 99, b: 177 } } });
  for (const [mimeType, bytes] of [
    ["image/jpeg", await source.clone().jpeg().toBuffer()],
    ["image/png", await source.clone().png().toBuffer()],
    ["image/webp", await source.clone().webp().toBuffer()],
  ] as const) {
    const normalized = await validateAndNormalizePetImage({ mimeType, data: bytes.toString("base64") });
    assert.equal(normalized.mimeType, "image/jpeg");
    const decoded = await sharp(Buffer.from(normalized.data, "base64")).metadata();
    assert.equal(decoded.format, "jpeg");
    assert.deepEqual([decoded.width, decoded.height], [40, 30]);
  }
});

test("decoder rejects MIME spoofing, malformed base64 and corrupt image bytes", async () => {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).jpeg().toBuffer();
  await assert.rejects(validateAndNormalizePetImage({ mimeType: "image/png", data: jpeg.toString("base64") }));
  await assert.rejects(validateAndNormalizePetImage({ mimeType: "image/gif", data: "R0lGODlh" }));
  await assert.rejects(validateAndNormalizePetImage({ mimeType: "image/jpeg", data: "not-base64!!" }));
  const corrupt = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  corrupt[29] ^= 0xff; // Corrupt the PNG IHDR CRC while preserving its outer structure.
  await assert.rejects(validateAndNormalizePetImage({ mimeType: "image/png", data: corrupt.toString("base64") }));
  await assert.rejects(validateAndNormalizePetImage(null));
});

test("decoder rejects polyglot trailing payloads in JPEG, PNG and WebP", async () => {
  for (const [mimeType, bytes] of [
    ["image/jpeg", await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).jpeg().toBuffer()],
    ["image/png", await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer()],
    ["image/webp", await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).webp().toBuffer()],
  ] as const) {
    const polyglot = Buffer.concat([bytes, Buffer.from("<script>alert(1)</script>")]);
    await assert.rejects(validateAndNormalizePetImage({ mimeType, data: polyglot.toString("base64") }));
  }
});

test("decoder rejects width and decoded raster above configured limits", async () => {
  const tooWide = await sharp({ create: { width: 6001, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
  const tooManyPixels = await sharp({ create: { width: 3000, height: 3000, channels: 4, background: "green" } }).png().toBuffer();
  assert.ok(tooWide.length < 1_200_000 && tooManyPixels.length < 1_200_000);
  await assert.rejects(validateAndNormalizePetImage({ mimeType: "image/png", data: tooWide.toString("base64") }));
  await assert.rejects(validateAndNormalizePetImage({ mimeType: "image/png", data: tooManyPixels.toString("base64") }));
});

test("decoder rejects requests exceeding the compressed input limit", async () => {
  await assert.rejects(validateAndNormalizePetImage({ mimeType: "image/png", data: Buffer.alloc(1_200_001).toString("base64") }));
});

test("Ollama vision normalizes estimates and does not invent missing confidence", async () => {
  let sentBody: Record<string, unknown> | undefined;
  const provider = new OllamaPetVisionProvider({ baseUrl: "http://127.0.0.1:11434", model: "llava:7b", timeoutMs: 1_000 }, async (_url, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ message: { content: JSON.stringify({
      animalDetected: true,
      species: { value: "Perro", confidence: 0.92 },
      breed: "No determinada",
      approximateAge: "adult",
      weightKg: { value: "4–6 kg", confidence: 0.55 },
      size: { value: "Mediano", confidence: 1.5 },
      coatColor: { value: "Canela", confidence: 0.8 },
      traits: { value: "Pelaje corto", confidence: 0.8 },
      uncertainty: "La edad no puede estimarse.",
    }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const result = await provider.identify({ mimeType: "image/jpeg", data: "aW1hZ2U=" });
  assert.deepEqual(result.species, { value: "Perro", confidence: 0.92 });
  assert.deepEqual(result.breed, { value: "No determinada", confidence: null });
  assert.deepEqual(result.approximateAge, { value: "adult", confidence: null });
  assert.deepEqual(result.weightKg, { value: "4–6 kg", confidence: 0.55 });
  assert.deepEqual(result.size, { value: "Mediano", confidence: null });
  assert.equal(result.uncertainty, "La edad no puede estimarse.");
  const messages = sentBody?.messages as Array<{ images?: string[] }>;
  assert.deepEqual(messages[0].images, ["aW1hZ2U="]);
});

test("Ollama vision timeout is reported as a recoverable error", async () => {
  const provider = new OllamaPetVisionProvider({ baseUrl: "http://127.0.0.1:11434", model: "llava:7b", timeoutMs: 1 }, async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }));
  await assert.rejects(provider.identify({ mimeType: "image/jpeg", data: "aW1hZ2U=" }), /agotó el tiempo/);
});

test("authenticated analysis endpoint validates the image and returns injected provider estimates", async () => {
  const secret = Buffer.from("pet-vision-route-secret-at-least-32-bytes");
  let receivedImage = false;
  const app = createApp({
    config: { corsOrigins: [], accessTokenSecret: secret },
    database: { query: async () => ({ rows: [] }) },
    authStore: new MemoryAuthStore(),
    logger: { info: () => undefined, error: () => undefined },
    petVisionProvider: { identify: async (image) => { receivedImage = image.mimeType === "image/jpeg"; return {
      animalDetected: true,
      species: { value: "Perro", confidence: 0.9 },
      breed: { value: null, confidence: null },
      approximateAge: { value: null, confidence: null },
      weightKg: { value: null, confidence: null },
      size: { value: null, confidence: null },
      coatColor: { value: null, confidence: null },
      traits: { value: null, confidence: null },
      uncertainty: "Raza no determinada.",
    }; } },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const unauthenticated = await fetch(`${baseUrl}/pet-identification/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: {} }) });
    assert.equal(unauthenticated.status, 401);
    assert.equal(receivedImage, false);
    const registered = await fetch(`${baseUrl}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "pet-vision@example.com", password: "correct horse battery staple", name: "Vision Test" }) });
    assert.equal(registered.status, 201);
    const { accessToken } = await registered.json() as { accessToken: string };
    const malformed = await fetch(`${baseUrl}/pet-identification/analyze`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: "{\"image\":" });
    assert.equal(malformed.status, 400);
    assert.equal(receivedImage, false);
    const image = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).jpeg().toBuffer()).toString("base64");
    const response = await fetch(`${baseUrl}/pet-identification/analyze`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ image: { mimeType: "image/jpeg", data: image } }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(receivedImage, true);
    assert.deepEqual((await response.json() as { species: { value: string } }).species, { value: "Perro", confidence: 0.9 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
