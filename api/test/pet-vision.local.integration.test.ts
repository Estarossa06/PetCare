import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import test from "node:test";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { loadPetVisionConfig } from "../src/modules/pet-identification/config.js";
import { OllamaPetVisionProvider } from "../src/modules/pet-identification/ollamaVisionProvider.js";
import type { PetIdentificationResult } from "../src/modules/pet-identification/types.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

const runLocalVision = process.env.PETCARE_RUN_LOCAL_VISION_TESTS === "1";
const dogPath = process.env.PETCARE_DOG_PHOTO_PATH;
const catPath = process.env.PETCARE_CAT_PHOTO_PATH;

function gpuMetrics(): { memoryUsedMiB: number; utilizationPercent: number } | null {
  try {
    const line = execFileSync("C:\\Windows\\System32\\nvidia-smi.exe", ["--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 2_000 }).trim().split(/\r?\n/)[0];
    const [memory, utilization] = line.split(",").map((part) => Number(part.trim()));
    return Number.isFinite(memory) && Number.isFinite(utilization) ? { memoryUsedMiB: memory, utilizationPercent: utilization } : null;
  } catch { return null; }
}

test("real dog/cat photos traverse authentication, image normalization and local Ollama inference", { skip: !runLocalVision }, async () => {
  assert.ok(dogPath && catPath, "Set PETCARE_DOG_PHOTO_PATH and PETCARE_CAT_PHOTO_PATH to real photographs.");
  const provider = new OllamaPetVisionProvider(loadPetVisionConfig());
  const app = createApp({
    config: { corsOrigins: [], accessTokenSecret: Buffer.from("local-pet-vision-test-secret-min-32-bytes") },
    database: { query: async () => ({ rows: [] }) },
    authStore: new MemoryAuthStore(),
    logger: { info: () => undefined, error: () => undefined },
    petVisionProvider: provider,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const samples = [
    { label: "dog", path: dogPath, expected: /dog|perro|canine|canino/i },
    { label: "cat", path: catPath, expected: /cat|gato|feline|felino/i },
  ];
  const failures: string[] = [];
  const rssSamples: number[] = [];
  const gpuSamples: Array<{ memoryUsedMiB: number; utilizationPercent: number }> = [];
  const sampler = setInterval(() => {
    rssSamples.push(process.memoryUsage().rss);
    const metrics = gpuMetrics();
    if (metrics) gpuSamples.push(metrics);
  }, 500);
  sampler.unref();
  try {
    const registration = await fetch(`${baseUrl}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "local-vision-test@example.invalid", password: "local-vision-test-password", name: "Local vision validation" }) });
    assert.equal(registration.status, 201, "registration must issue the authenticated session used for photo analysis");
    const { accessToken } = await registration.json() as { accessToken: string };
    for (const sample of samples) {
      const original = await readFile(sample.path);
      const normalized = await sharp(original, { failOn: "warning", limitInputPixels: 12_000_000, sequentialRead: true }).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      assert.ok(normalized.byteLength <= 1_200_000, `${sample.label} fixture must fit server input limit`);
      const beforeRss = process.memoryUsage().rss;
      const beforeGpu = gpuMetrics();
      const startedAt = performance.now();
      const response = await fetch(`${baseUrl}/pet-identification/analyze`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ image: { mimeType: "image/jpeg", data: normalized.toString("base64") } }) });
      const latencyMs = Math.round(performance.now() - startedAt);
      assert.equal(response.status, 200, `${sample.label} image analysis should succeed`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const result = await response.json() as PetIdentificationResult;
      const afterGpu = gpuMetrics();
      console.log(JSON.stringify({ event: "local_pet_vision_result", photo: sample.label, sourceBytes: original.byteLength, normalizedBytes: normalized.byteLength, latencyMs, model: loadPetVisionConfig().model, species: result.species, breed: result.breed, approximateAge: result.approximateAge, uncertainty: result.uncertainty, rssBeforeMiB: Math.round(beforeRss / 2 ** 20), rssAfterMiB: Math.round(process.memoryUsage().rss / 2 ** 20), beforeGpu, afterGpu }));
      if (result.animalDetected !== true) failures.push(`${sample.label}: expected an animal, got ${String(result.animalDetected)}`);
      if (!sample.expected.test(result.species.value ?? "")) failures.push(`${sample.label}: expected ${sample.label} species, got ${JSON.stringify(result.species.value)}`);
    }
    const peakRss = Math.max(...rssSamples, process.memoryUsage().rss);
    const peakGpu = gpuSamples.reduce((max, sample) => Math.max(max, sample.memoryUsedMiB), 0);
    console.log(JSON.stringify({ event: "local_pet_vision_resources", peakRssMiB: Math.round(peakRss / 2 ** 20), sampledPeakGpuMiB: peakGpu, gpuSamples: gpuSamples.length }));
    assert.deepEqual(failures, [], "real photo species identification should be correct for both dog and cat samples");
  } finally {
    clearInterval(sampler);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
