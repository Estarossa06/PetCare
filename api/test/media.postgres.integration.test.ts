import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { getMigrationStatus } from "../src/db/migration-runner.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import { R2ObjectStore, type MediaObjectStore } from "../src/modules/media/objectStore.js";
import type { Logger } from "../src/observability/logger.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const realR2 = process.env.PETCARE_RUN_MEDIA_R2_TESTS === "1";
const enabled = Boolean(databaseUrl) && (process.env.PETCARE_RUN_MEDIA_DB_TESTS === "1" || realR2);
const secret = Buffer.from("media-postgres-test-secret-at-least-32-bytes");
const silentLogger: Logger = { info: () => {}, error: () => {} };

function validPdf(): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>\nendobj\n",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(output, "latin1")); output += object; }
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

async function interruptUpload(base: string, token: string, path: string, id: string, bytes: Buffer, hash: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = httpRequest(new URL(`${base}${path}`), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "X-Upload-Id": id,
        "X-Checksum-Sha256": hash,
        "X-File-Name": "interrupted.png",
      },
    });
    request.once("error", () => resolve());
    request.write(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))));
    request.destroy();
    setTimeout(resolve, 100);
  });
}

async function removeTestObjects(store: MediaObjectStore, ownerId: string): Promise<void> {
  const prefix = `media/${ownerId}/`;
  let continuationToken: string | undefined;
  for (let pageNo = 0; pageNo < 100; pageNo += 1) {
    const page = await store.list(prefix, continuationToken);
    for (const object of page.keys) await store.delete(object.key);
    continuationToken = page.continuationToken;
    if (!continuationToken) return assert.equal((await store.list(prefix)).keys.length, 0, "Temporary R2 test objects were not fully removed.");
  }
  throw new Error("R2 test prefix exceeded the cleanup page limit.");
}

async function waitForRemoteDelete(store: MediaObjectStore, prefix: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await store.list(prefix)).keys.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`R2 did not remove a tombstoned object under the test prefix ${prefix}.`);
}

class MemoryStore implements MediaObjectStore {
  readonly objects = new Map<string, Buffer>();
  failPut = false;
  async put(key: string, file: string): Promise<void> { if (this.failPut) throw new Error("simulated disconnected object store"); this.objects.set(key, await readFile(file)); }
  async get(key: string): Promise<Readable> { const value = this.objects.get(key); if (!value) throw new Error("missing"); return Readable.from(value); }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
  async list() { return { keys: [] }; }
}

test("media API streams private photo and medical files with owner checks, checksum, idempotency and tombstones", { skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_MEDIA_DB_TESTS=1 for petcare_test." }, async () => {
  const parsed = new URL(databaseUrl!);
  assert.equal(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "petcare_test", "Refusing non-test PostgreSQL target.");
  if (realR2) {
    for (const key of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      assert.ok(process.env[key]?.trim(), `${key} must be configured for the real R2 test.`);
    }
    assert.equal(process.env.R2_BUCKET, "petcare-media", "Refusing a bucket other than petcare-media.");
  }
  const pool = createDatabasePool(databaseUrl!);
  const runId = randomUUID();
  const emails = [`media-${runId}-a@example.test`, `media-${runId}-b@example.test`];
  const store: MediaObjectStore = realR2
    ? new R2ObjectStore({
        accountId: process.env.R2_ACCOUNT_ID!,
        bucket: process.env.R2_BUCKET!,
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      })
    : new MemoryStore();
  let server: Server | undefined;
  let ownerIds: string[] = [];
  let fixtureStarted = false;
  let remoteCleanupFailed = false;
  try {
    if (realR2) await store.list(`petcare-r2-connectivity/${runId}/`);
    assert.equal((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database, "petcare_test");
    const migrationStatus = await getMigrationStatus(pool);
    assert.equal(migrationStatus.migrations.find((migration) => migration.name === "media_storage")?.status, "Applied");
    server = createServer(createApp({ config: { corsOrigins: [], accessTokenSecret: secret }, database: pool, authStore: new PostgresAuthStore(pool), logger: silentLogger, mediaStore: store }));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    let base = `http://127.0.0.1:${address.port}`;
    const register = async (email: string) => {
      const response = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "media integration password", name: "Media owner" }) });
      assert.equal(response.status, 201); return await response.json() as { accessToken: string; user: { id: string } };
    };
    const [a, b] = await Promise.all(emails.map(register)); ownerIds = [a.user.id, b.user.id]; fixtureStarted = true;
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const petResponse = await fetch(`${base}/pets`, { method: "POST", headers: { ...auth(a.accessToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: "Media test pet", species: "cat" }) });
    assert.equal(petResponse.status, 201);
    const petId = ((await petResponse.json()) as { pet: { id: string } }).pet.id;
    const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#2277aa" } }).png().toBuffer();
    const hash = createHash("sha256").update(image).digest("hex");
    const assetId = randomUUID();
    const upload = (token: string, path: string, bytes = image, checksum = hash, extra: Record<string, string> = {}, id = assetId) => fetch(`${base}${path}`, { method: "POST", headers: { ...auth(token), "Content-Type": "image/png", "X-Upload-Id": id, "X-Checksum-Sha256": checksum, "X-File-Name": "pet.png", ...extra }, body: bytes });
    const photo = await upload(a.accessToken, `/media/pets/${petId}/photo`);
    assert.equal(photo.status, 201); assert.equal((await photo.json() as { idempotent: boolean }).idempotent, false);
    const duplicate = await upload(a.accessToken, `/media/pets/${petId}/photo`);
    assert.equal(duplicate.status, 200); assert.equal((await duplicate.json() as { idempotent: boolean }).idempotent, true);
    assert.equal((await fetch(`${base}/media/assets/${assetId}/content`, { headers: auth(b.accessToken) })).status, 404);
    assert.equal((await fetch(`${base}/media/pets/${petId}/photo`, { method: "POST", headers: { ...auth(b.accessToken), "Content-Type": "image/png", "X-Upload-Id": randomUUID(), "X-Checksum-Sha256": hash, "X-File-Name": "pet.png" }, body: image })).status, 404);
    const downloaded = await fetch(`${base}/media/assets/${assetId}/content`, { headers: auth(a.accessToken) });
    assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get("x-content-sha256"), hash); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), image);
    const objectKey = `media/${a.user.id}/${assetId}/${hash}`;
    if (store instanceof MemoryStore) {
      store.objects.set(objectKey, Buffer.from("corrupt at rest"));
      assert.equal((await fetch(`${base}/media/assets/${assetId}/content`, { headers: auth(a.accessToken) })).status, 503);
    } else {
      const direct = await store.get(objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of direct) chunks.push(Buffer.from(chunk));
      assert.equal(createHash("sha256").update(Buffer.concat(chunks)).digest("hex"), hash);
      assert.equal((await store.list(`media/${a.user.id}/${assetId}/`)).keys.length, 1);
    }
    const badId = randomUUID();
    const bad = await fetch(`${base}/media/pets/${petId}/photo`, { method: "POST", headers: { ...auth(a.accessToken), "Content-Type": "image/png", "X-Upload-Id": badId, "X-Checksum-Sha256": "0".repeat(64), "X-File-Name": "bad.png" }, body: image });
    assert.equal(bad.status, 422);
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    assert.equal((await upload(a.accessToken, `/media/pets/${petId}/photo`, oversized, createHash("sha256").update(oversized).digest("hex"), {}, randomUUID())).status, 413);
    const retryId = randomUUID();
    if (store instanceof MemoryStore) {
      store.failPut = true;
      assert.equal((await upload(a.accessToken, `/media/pets/${petId}/photo`, image, hash, {}, retryId)).status, 503);
      store.failPut = false;
      assert.equal((await upload(a.accessToken, `/media/pets/${petId}/photo`, image, hash, {}, retryId)).status, 201);
    } else {
      await interruptUpload(base, a.accessToken, `/media/pets/${petId}/photo`, retryId, image, hash);
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      server = undefined;
      server = createServer(createApp({ config: { corsOrigins: [], accessTokenSecret: secret }, database: pool, authStore: new PostgresAuthStore(pool), logger: silentLogger, mediaStore: store }));
      server.listen(0, "127.0.0.1"); await once(server, "listening");
      const resumedAddress = server.address(); assert.ok(resumedAddress && typeof resumedAddress !== "string");
      base = `http://127.0.0.1:${resumedAddress.port}`;
      const recovered = await upload(a.accessToken, `/media/pets/${petId}/photo`, image, hash, {}, retryId);
      assert.ok(recovered.status === 200 || recovered.status === 201, `Retry after interrupted upload returned ${recovered.status}.`);
      const recoveredBody = await recovered.json() as { asset: { id: string; sha256: string }; idempotent: boolean };
      assert.equal(recoveredBody.asset.id, retryId);
      assert.equal(recoveredBody.asset.sha256, hash);
      if (recovered.status === 200) assert.equal(recoveredBody.idempotent, true);
    }

    const recordId = randomUUID();
    await pool.query("INSERT INTO health_records(id,owner_id,pet_id,record_type,title,occurred_at) VALUES($1,$2,$3,'observation','test attachment',now())", [recordId, a.user.id, petId]);
    const pdf = validPdf(); const pdfHash = createHash("sha256").update(pdf).digest("hex"); const attachmentId = randomUUID();
    const attachment = await fetch(`${base}/media/health-records/${recordId}/attachments`, { method: "POST", headers: { ...auth(a.accessToken), "Content-Type": "application/pdf", "X-Upload-Id": attachmentId, "X-Checksum-Sha256": pdfHash, "X-File-Name": "visit.pdf", "X-Pet-Id": petId }, body: pdf });
    assert.equal(attachment.status, 201);
    const pdfDownload = await fetch(`${base}/media/assets/${attachmentId}/content`, { headers: auth(a.accessToken) });
    assert.equal(pdfDownload.status, 200);
    assert.equal(pdfDownload.headers.get("x-content-sha256"), pdfHash);
    assert.deepEqual(Buffer.from(await pdfDownload.arrayBuffer()), pdf);
    assert.equal((await fetch(`${base}/media/assets/${attachmentId}/content`, { headers: auth(b.accessToken) })).status, 404);
    if (realR2) {
      const invalidId = randomUUID();
      const invalidBytes = Buffer.from("not an image");
      const invalidHash = createHash("sha256").update(invalidBytes).digest("hex");
      const invalidImage = await upload(a.accessToken, `/media/pets/${petId}/photo`, invalidBytes, invalidHash, {}, invalidId);
      assert.ok(invalidImage.status >= 400 && invalidImage.status < 500);
      const invalidPdf = Buffer.from("%PDF-1.4\nnot a valid PDF\n%%EOF\n", "ascii");
      const invalidPdfResponse = await fetch(`${base}/media/health-records/${recordId}/attachments`, {
        method: "POST",
        headers: { ...auth(a.accessToken), "Content-Type": "application/pdf", "X-Upload-Id": randomUUID(), "X-Checksum-Sha256": createHash("sha256").update(invalidPdf).digest("hex"), "X-File-Name": "invalid.pdf", "X-Pet-Id": petId },
        body: invalidPdf,
      });
      assert.ok(invalidPdfResponse.status >= 400 && invalidPdfResponse.status < 500);
      const oversizedPdf = Buffer.alloc(15 * 1024 * 1024 + 1, 0);
      const oversizedPdfResponse = await fetch(`${base}/media/health-records/${recordId}/attachments`, {
        method: "POST",
        headers: { ...auth(a.accessToken), "Content-Type": "application/pdf", "X-Upload-Id": randomUUID(), "X-Checksum-Sha256": createHash("sha256").update(oversizedPdf).digest("hex"), "X-File-Name": "oversized.pdf", "X-Pet-Id": petId },
        body: oversizedPdf,
      });
      assert.equal(oversizedPdfResponse.status, 413);
    }
    assert.equal((await fetch(`${base}/media/assets/${assetId}`, { method: "DELETE", headers: auth(b.accessToken) })).status, 204);
    if (realR2) assert.equal((await store.list(`media/${a.user.id}/${assetId}/`)).keys.length, 1, "Another owner must not delete the asset.");
    assert.equal((await fetch(`${base}/media/assets/${retryId}`, { method: "DELETE", headers: auth(a.accessToken) })).status, 204);
    assert.equal((await fetch(`${base}/media/assets/${attachmentId}`, { method: "DELETE", headers: auth(a.accessToken) })).status, 204);
    if (realR2) {
      await waitForRemoteDelete(store, `media/${a.user.id}/${retryId}/`);
      await waitForRemoteDelete(store, `media/${a.user.id}/${attachmentId}/`);
    }
    const changes = await fetch(`${base}/media/changes?after_cursor=0`, { headers: auth(a.accessToken) });
    const result = await changes.json() as { assets: Array<{ id: string; deletedAt: string | null }> };
    assert.ok(result.assets.some((asset) => asset.id === assetId && asset.deletedAt));
    assert.ok(result.assets.some((asset) => asset.id === retryId && asset.deletedAt));
    assert.ok(result.assets.some((asset) => asset.id === attachmentId && asset.deletedAt));
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    try {
      if (realR2 && ownerIds[0]) await removeTestObjects(store, ownerIds[0]);
    } catch {
      remoteCleanupFailed = true;
      silentLogger.error({ event: "media_r2_test_cleanup_failed", testRunId: runId });
    }
    try {
      if (fixtureStarted) {
        await pool.query("DELETE FROM media_objects WHERE owner_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query("DELETE FROM media_cleanup_queue WHERE object_key LIKE $1", [`media/${ownerIds[0]}/%`]);
        await pool.query("DELETE FROM health_attachments WHERE owner_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query("DELETE FROM health_records WHERE owner_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query("DELETE FROM pets WHERE owner_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query("DELETE FROM sync_changes WHERE owner_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query("DELETE FROM sync_cursors WHERE owner_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query("DELETE FROM sync_devices WHERE user_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query("DELETE FROM sync_operations WHERE user_id=ANY($1::uuid[])", [ownerIds]);
        await pool.query(`DELETE FROM auth_refresh_tokens t USING auth_sessions s, users u WHERE t.session_id=s.id AND s.user_id=u.id AND u.email=ANY($1::text[])`, [emails]);
        await pool.query("DELETE FROM auth_sessions s USING users u WHERE s.user_id=u.id AND u.email=ANY($1::text[])", [emails]);
        await pool.query("DELETE FROM users WHERE email=ANY($1::text[])", [emails]);
        assert.equal((await pool.query("SELECT 1 FROM users WHERE email=ANY($1::text[])", [emails])).rows.length, 0);
      }
    } finally {
      await pool.end();
    }
    if (remoteCleanupFailed) throw new Error(`R2 temporary object cleanup failed for test run ${runId}.`);
  }
});
