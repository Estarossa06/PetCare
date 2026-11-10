import "dotenv/config";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { loadDatabaseUrl } from "../config/env.js";
import { migrations } from "./migrations/index.js";

const lockId = 872_411_026;

function checksum(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function assertKnownMigrationVersions(client: PoolClient): Promise<void> {
  const knownVersions = new Set(migrations.map((migration) => migration.version));
  const applied = await client.query<{ version: number }>(
    "SELECT version FROM schema_migrations",
  );
  const unknownVersion = applied.rows.find((row) => !knownVersions.has(row.version));
  if (unknownVersion) {
    throw new Error(
      `Database contains unknown migration version ${unknownVersion.version}; refusing to continue.`,
    );
  }
}

async function runUp(client: PoolClient): Promise<void> {
  await ensureMigrationTable(client);
  await assertKnownMigrationVersions(client);

  for (const migration of migrations) {
    const source = migration.up.toString();
    const expectedChecksum = checksum(source);
    const result = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations WHERE version = $1",
      [migration.version],
    );

    if (result.rowCount) {
      if (
        result.rows[0].name !== migration.name ||
        result.rows[0].checksum !== expectedChecksum
      ) {
        throw new Error(
          `Migration ${migration.version} (${migration.name}) was changed after it was applied.`,
        );
      }
      console.log(`Already applied: ${migration.version} ${migration.name}`);
      continue;
    }

    await client.query("BEGIN");
    try {
      await migration.up(client);
      await client.query(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, expectedChecksum],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log(`Applied: ${migration.version} ${migration.name}`);
  }
}

async function runStatus(client: PoolClient): Promise<void> {
  const table = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  const applied = table.rows[0].exists
    ? await client.query<{ version: number; name: string; checksum: string }>(
        "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
      )
    : { rows: [] as { version: number; name: string; checksum: string }[] };
  const knownVersions = new Set(migrations.map((migration) => migration.version));
  const unknownVersion = applied.rows.find((row) => !knownVersions.has(row.version));
  if (unknownVersion) {
    throw new Error(
      `Database contains unknown migration version ${unknownVersion.version}; refusing to continue.`,
    );
  }
  const appliedVersions = new Map(applied.rows.map((row) => [row.version, row]));

  for (const migration of migrations) {
    const appliedMigration = appliedVersions.get(migration.version);
    if (
      appliedMigration &&
      (appliedMigration.name !== migration.name ||
        appliedMigration.checksum !== checksum(migration.up.toString()))
    ) {
      throw new Error(
        `Applied migration ${migration.version} (${migration.name}) has changed.`,
      );
    }
    console.log(
      `${appliedMigration ? "Applied" : "Pending"}: ${migration.version} ${migration.name}`,
    );
  }
}

async function main(): Promise<void> {
  const connectionString = loadDatabaseUrl();
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockId]);
    const action = process.argv[2] ?? "up";
    if (action === "up") {
      await runUp(client);
    } else if (action === "status") {
      await runStatus(client);
    } else {
      throw new Error(`Unknown migration command "${action}". Use "up" or "status".`);
    }
    await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected migration failure.";
  console.error(`Database migration failed: ${message}`);
  process.exitCode = 1;
});
