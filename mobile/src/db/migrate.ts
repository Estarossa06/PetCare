import { migrations } from "./migrations";
import type { SqliteExecutor } from "./migrations/types";

export async function migrateLocalDatabase(db: SqliteExecutor): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = ON");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS _local_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

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

export async function recoverInterruptedSync(db: SqliteExecutor): Promise<void> {
  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'pending', updated_at = ?
     WHERE status = 'in_flight'`,
    new Date().toISOString(),
  );
}
