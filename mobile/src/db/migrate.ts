import { migrations } from "./migrations/index.ts";
import type { SqliteExecutor } from "./migrations/types.ts";

export async function migrateLocalDatabase(db: SqliteExecutor): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = ON");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS _local_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const latest = await db.getFirstAsync<{ version: number | null }>(
    "SELECT max(version) AS version FROM _local_migrations",
  );
  const highestApplied = latest?.version ?? 0;
  if (!Number.isSafeInteger(highestApplied) || highestApplied < 0 || highestApplied > migrations.length) {
    throw new Error("SQLite migration ledger contains an unknown version.");
  }
  if (highestApplied === 0) {
    const existingTables = await db.getFirstAsync<{ has_tables: number }>(
      `SELECT EXISTS (SELECT 1 FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_local_migrations') AS has_tables`,
    );
    if (existingTables?.has_tables) {
      throw new Error("SQLite has application tables but no recognized migration history; refusing to migrate.");
    }
  }

  // Validate the full applied prefix before applying any application DDL.
  for (let version = 1; version <= highestApplied; version += 1) {
    const row = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM _local_migrations WHERE version = ?",
      version,
    );
    const expected = migrations[version - 1];
    if (!row) throw new Error(`SQLite migration ledger has a gap at version ${version}; refusing to migrate.`);
    if (!expected || row.name !== expected.name) {
      throw new Error(`SQLite migration ${version} has an unexpected name; refusing to migrate.`);
    }
  }

  for (const migration of migrations) {
    const applied = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM _local_migrations WHERE version = ?",
      migration.version,
    );
    if (applied) {
      if (applied.name !== migration.name) {
        throw new Error(`SQLite migration ${migration.version} has an unexpected name.`);
      }
      continue;
    }

    await db.execAsync("BEGIN IMMEDIATE");
    try {
      await migration.up(db);
      await db.runAsync(
        "INSERT INTO _local_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      await db.execAsync("COMMIT");
    } catch (error) {
      await db.execAsync("ROLLBACK");
      throw error;
    }
  }
}
