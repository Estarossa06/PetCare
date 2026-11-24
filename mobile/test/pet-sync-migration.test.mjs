import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import migration from "../src/db/migrations/0007_pet_sync_state.ts";

test("pet sync migration preserves local rows and outbox while separating local and server revisions", async () => {
  const database = new DatabaseSync(":memory:");
  const account = "00000000-0000-4000-8000-000000000001";
  const pet = "00000000-0000-4000-8000-000000000002";
  database.exec(`
    CREATE TABLE sync_metadata (account_id TEXT PRIMARY KEY, last_download_cursor INTEGER NOT NULL DEFAULT 0, last_successful_sync_at TEXT, schema_version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, auth_user_id TEXT);
    CREATE TABLE pets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE sync_queue (
      operation_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL,
      base_version INTEGER NOT NULL DEFAULT 0, changed_fields TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO sync_metadata (account_id, updated_at) VALUES ('${account}', '2026-01-01T00:00:00.000Z');
    INSERT INTO pets (id, owner_id, version, created_at, updated_at) VALUES ('${pet}', '${account}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO sync_queue (operation_id, account_id, entity_type, entity_id, action, payload, base_version, created_at, updated_at) VALUES
      ('00000000-0000-4000-8000-000000000011', '${account}', 'pet', '${pet}', 'create', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('00000000-0000-4000-8000-000000000012', '${account}', 'pet', '${pet}', 'update', '{}', 0, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  `);
  try {
    await migration.up({ execAsync: async (sql) => database.exec(sql) });
    const petState = database.prepare("SELECT local_revision, server_version, acknowledged_local_revision FROM pets WHERE id = ?").get(pet);
    assert.deepEqual({ ...petState }, { local_revision: 2, server_version: 0, acknowledged_local_revision: 0 });
    const operations = database.prepare("SELECT operation_id, local_revision, base_version FROM sync_queue WHERE entity_id = ? ORDER BY rowid").all(pet);
    assert.deepEqual(operations.map((operation) => ({ ...operation })), [
      { operation_id: "00000000-0000-4000-8000-000000000011", local_revision: 1, base_version: 0 },
      { operation_id: "00000000-0000-4000-8000-000000000012", local_revision: 2, base_version: 1 },
    ]);
    assert.equal(database.prepare("SELECT count(*) AS count FROM pets WHERE owner_id = ?").get(account).count, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM sync_queue").get().count, 2);
    assert.equal(database.prepare("SELECT device_id FROM sync_metadata WHERE account_id = ?").get(account).device_id, null);
  } finally {
    database.close();
  }
});
