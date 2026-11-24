import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";
import mediaMigration from "../src/db/migrations/0010_media_storage.ts";

const migrationText = await readFile(new URL("../src/db/migrations/0010_media_storage.ts", import.meta.url), "utf8");
const recovery = await readFile(new URL("../src/db/recoverSync.ts", import.meta.url), "utf8");
const sync = await readFile(new URL("../src/features/sync/mediaSync.ts", import.meta.url), "utf8");

test("media migration preserves local file keys and leaves legacy files out of the upload queue", async () => {
  assert.match(migrationText, /CREATE TABLE media_upload_queue/);
  assert.match(migrationText, /UNIQUE\(account_id,asset_id,action,sha256\)/);
  assert.match(migrationText, /DEFAULT 'local_only'/);
  assert.match(migrationText, /ALTER TABLE health_attachments ADD COLUMN remote_asset_id/);
  assert.doesNotMatch(migrationText, /INSERT INTO media_upload_queue/);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE pets(id TEXT PRIMARY KEY,photo_storage_key TEXT);
      CREATE TABLE health_attachments(id TEXT PRIMARY KEY,storage_key TEXT);
      CREATE TABLE sync_metadata(account_id TEXT PRIMARY KEY,updated_at TEXT NOT NULL);
      INSERT INTO pets VALUES('pet','pet-photos/local.jpg');
      INSERT INTO health_attachments VALUES('attachment','medical-files/local.pdf');
      INSERT INTO sync_metadata VALUES('account','before');`);
    await mediaMigration.up({ execAsync: async (sql) => db.exec(sql) });
    assert.equal(db.prepare("SELECT photo_storage_key FROM pets WHERE id='pet'").get().photo_storage_key, "pet-photos/local.jpg");
    const attachment = db.prepare("SELECT storage_key,upload_status,remote_asset_id FROM health_attachments WHERE id='attachment'").get();
    assert.equal(attachment.storage_key, "medical-files/local.pdf");
    assert.equal(attachment.remote_asset_id, null);
    assert.equal(attachment.upload_status, "local_only");
    assert.equal(db.prepare("SELECT count(*) AS count FROM media_upload_queue").get().count, 0);
  } finally { db.close(); }
});

test("interrupted media uploads recover and retries use a stable asset ID and checksum", () => {
  assert.match(recovery, /UPDATE media_upload_queue[\s\S]*status='pending'[\s\S]*status='in_flight'/);
  assert.match(sync, /X-Upload-Id/);
  assert.match(sync, /X-Checksum-Sha256/);
  assert.match(sync, /sha256Hex/);
  assert.match(sync, /ORDER BY q.created_at/);
});

test("media pull is owner-account scoped and verifies bytes before persistent storage", () => {
  assert.match(sync, /if \(owner !== accountId\) return/);
  assert.match(sync, /blob\.size !== asset\.sizeBytes/);
  assert.match(sync, /sha256Hex\(await blob\.arrayBuffer\(\)\)/);
  assert.match(sync, /await petPhotoStorage\.saveRemotePhoto/);
  assert.match(sync, /await medicalFileStorage\.saveRemote/);
});
