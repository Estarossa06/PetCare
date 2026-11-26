import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrateLocalDatabase } from "../src/db/migrate.ts";
import { migrations } from "../src/db/migrations/index.ts";

function createExecutor(database) {
  return {
    execAsync: async (sql) => database.exec(sql),
    runAsync: async (sql, ...values) => database.prepare(sql).run(...values),
    getFirstAsync: async (sql, ...values) => database.prepare(sql).get(...values) ?? null,
  };
}

test("SQLite migration runner applies a contiguous history once and validates it on reopen", async () => {
  const database = new DatabaseSync(":memory:");
  const executor = createExecutor(database);
  try {
    await migrateLocalDatabase(executor);
    const applied = database.prepare("SELECT version,name FROM _local_migrations ORDER BY version").all();
    assert.equal(applied.length, migrations.length);
    assert.deepEqual(applied.map((row) => row.version), migrations.map((migration) => migration.version));
    await migrateLocalDatabase(executor);
    assert.equal(database.prepare("SELECT count(*) AS count FROM _local_migrations").get().count, migrations.length);
  } finally {
    database.close();
  }
});

test("SQLite migration runner rejects a gapped or unknown ledger before application DDL", async () => {
  const database = new DatabaseSync(":memory:");
  const executor = createExecutor(database);
  try {
    await migrateLocalDatabase(executor);
    const tablesBefore = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    database.prepare("DELETE FROM _local_migrations WHERE version=4").run();
    await assert.rejects(migrateLocalDatabase(executor), /gap at version 4/);
    assert.deepEqual(
      database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
      tablesBefore,
    );
    database.prepare("INSERT INTO _local_migrations(version,name,applied_at) VALUES(99,'unknown','now')").run();
    await assert.rejects(migrateLocalDatabase(executor), /unknown version/);
  } finally {
    database.close();
  }
});

test("SQLite migration runner refuses application tables without a migration ledger", async () => {
  const database = new DatabaseSync(":memory:");
  const executor = createExecutor(database);
  try {
    database.exec("CREATE TABLE pets(id TEXT PRIMARY KEY)");
    await assert.rejects(migrateLocalDatabase(executor), /no recognized migration history/);
    assert.equal(database.prepare("SELECT count(*) AS count FROM _local_migrations").get().count, 0);
  } finally {
    database.close();
  }
});
