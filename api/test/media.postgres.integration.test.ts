import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { migrations } from "../src/db/migrations/index.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import type { MediaObjectStore } from "../src/modules/media/objectStore.js";
import type { Logger } from "../src/observability/logger.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.PETCARE_RUN_MEDIA_DB_TESTS === "1";
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
  const pool = createDatabasePool(databaseUrl!);
  const runId = randomUUID();
  const emails = [`media-${runId}-a@example.test`, `media-${runId}-b@example.test`];
  const store = new MemoryStore();
  let server: Server | undefined;
  let ownerIds: string[] = [];
  let fixtureStarted = false;
  try {
    assert.equal((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database, "petcare_test");
    const applied = new Map((await pool.query<{ version: number; name: string; checksum: string }>("SELECT version,name,checksum FROM schema_migrations")).rows.map((row) => [row.version, row]));
    for (const migration of migrations) {
      const row = applied.get(migration.version);
      assert.ok(row, `Migration ${migration.version} is required.`);
      assert.equal(row.name, migration.name);
      assert.equal(row.checksum, createHash("sha256").update(migration.up.toString()).digest("hex"));
    }
    server = createServer(createApp({ config: { corsOrigins: [], accessTokenSecret: secret }, database: pool, authStore: new PostgresAuthStore(pool), logger: silentLogger, mediaStore: store }));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
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
    store.objects.set(objectKey, Buffer.from("corrupt at rest"));
    assert.equal((await fetch(`${base}/media/assets/${assetId}/content`, { headers: auth(a.accessToken) })).status, 503);
    const badId = randomUUID();
    const bad = await fetch(`${base}/media/pets/${petId}/photo`, { method: "POST", headers: { ...auth(a.accessToken), "Content-Type": "image/png", "X-Upload-Id": badId, "X-Checksum-Sha256": "0".repeat(64), "X-File-Name": "bad.png" }, body: image });
    assert.equal(bad.status, 422);
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    assert.equal((await upload(a.accessToken, `/media/pets/${petId}/photo`, oversized, createHash("sha256").update(oversized).digest("hex"), {}, randomUUID())).status, 413);
    const retryId = randomUUID(); store.failPut = true;
    assert.equal((await upload(a.accessToken, `/media/pets/${petId}/photo`, image, hash, {}, retryId)).status, 503);
    store.failPut = false;
    assert.equal((await upload(a.accessToken, `/media/pets/${petId}/photo`, image, hash, {}, retryId)).status, 201);

    const recordId = randomUUID();
    await pool.query("INSERT INTO health_records(id,owner_id,pet_id,record_type,title,occurred_at) VALUES($1,$2,$3,'observation','test attachment',now())", [recordId, a.user.id, petId]);
    const pdf = validPdf(); const pdfHash = createHash("sha256").update(pdf).digest("hex"); const attachmentId = randomUUID();
    const attachment = await fetch(`${base}/media/health-records/${recordId}/attachments`, { method: "POST", headers: { ...auth(a.accessToken), "Content-Type": "application/pdf", "X-Upload-Id": attachmentId, "X-Checksum-Sha256": pdfHash, "X-File-Name": "visit.pdf", "X-Pet-Id": petId }, body: pdf });
    assert.equal(attachment.status, 201);
    assert.equal((await fetch(`${base}/media/assets/${attachmentId}/content`, { headers: auth(b.accessToken) })).status, 404);
    assert.equal((await fetch(`${base}/media/assets/${assetId}`, { method: "DELETE", headers: auth(b.accessToken) })).status, 204);
    assert.equal((await fetch(`${base}/media/assets/${assetId}`, { method: "DELETE", headers: auth(a.accessToken) })).status, 204);
    const changes = await fetch(`${base}/media/changes?after_cursor=0`, { headers: auth(a.accessToken) });
    const result = await changes.json() as { assets: Array<{ id: string; deletedAt: string | null }> };
    assert.ok(result.assets.some((asset) => asset.id === assetId && asset.deletedAt));
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
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
    await pool.end();
  }
});
