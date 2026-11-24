import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import migration from "../src/db/migrations/0006_authenticated_local_accounts.ts";

test("authenticated local account migration preserves anonymous data and separates users", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE sync_metadata (
        account_id TEXT PRIMARY KEY NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO sync_metadata VALUES (
        '00000000-0000-4000-8000-000000000001', '2026-01-01'
      );
    `);
    await migration.up({
      execAsync: async (sql) => database.exec(sql),
    });

    const insert = database.prepare(
      "INSERT INTO sync_metadata (account_id, auth_user_id, updated_at) VALUES (?, ?, ?)",
    );
    insert.run("00000000-0000-4000-8000-000000000002", "11111111-1111-4111-8111-111111111111", "2026-01-02");
    insert.run("00000000-0000-4000-8000-000000000003", "22222222-2222-4222-8222-222222222222", "2026-01-02");

    assert.equal(database.prepare("SELECT count(*) AS count FROM sync_metadata WHERE auth_user_id IS NULL").get().count, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM sync_metadata WHERE auth_user_id IS NOT NULL").get().count, 2);
    assert.throws(() => insert.run("00000000-0000-4000-8000-000000000004", "11111111-1111-4111-8111-111111111111", "2026-01-03"));
    assert.throws(() => insert.run("00000000-0000-4000-8000-000000000005", "not-a-uuid", "2026-01-03"));
  } finally {
    database.close();
  }
});
