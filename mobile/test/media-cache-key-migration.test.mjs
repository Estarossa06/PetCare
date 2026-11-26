import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { prepareAccountScopedMediaCache } from "../src/features/sync/mediaCacheKeyMigration.ts";

test("legacy media cursors reset once and remain scoped to the active local account", async () => {
  const database = new DatabaseSync(":memory:");
  const accountA = "00000000-0000-4000-8000-000000000001";
  const accountB = "00000000-0000-4000-8000-000000000002";
  database.exec(`CREATE TABLE sync_metadata(account_id TEXT PRIMARY KEY,media_cache_key_version INTEGER NOT NULL,media_download_cursor INTEGER NOT NULL,updated_at TEXT);
    INSERT INTO sync_metadata VALUES('${accountA}',0,81,'old');
    INSERT INTO sync_metadata VALUES('${accountB}',1,42,'new');`);
  const db = {
    getFirstAsync: async (sql, ...values) => database.prepare(sql).get(...values) ?? null,
    runAsync: async (sql, ...values) => database.prepare(sql).run(...values),
  };
  try {
    assert.equal(await prepareAccountScopedMediaCache(db, accountA), true);
    assert.deepEqual(
      { ...database.prepare("SELECT media_cache_key_version,media_download_cursor FROM sync_metadata WHERE account_id=?").get(accountA) },
      { media_cache_key_version: 1, media_download_cursor: 0 },
    );
    assert.deepEqual(
      { ...database.prepare("SELECT media_cache_key_version,media_download_cursor FROM sync_metadata WHERE account_id=?").get(accountB) },
      { media_cache_key_version: 1, media_download_cursor: 42 },
    );
    assert.equal(await prepareAccountScopedMediaCache(db, accountA), false);
  } finally {
    database.close();
  }
});
