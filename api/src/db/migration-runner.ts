import type { PoolClient } from "pg";
import {
  getMigrationStatuses,
  migrationChecksum,
  resolveMigrationLineage,
  type AppliedMigration,
} from "./migration-lineage.js";

type MigrationClient = PoolClient;

export interface MigrationLedgerSnapshot {
  exists: boolean;
  rows: AppliedMigration[];
}

async function readLedger(client: MigrationClient): Promise<MigrationLedgerSnapshot> {
  const table = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  if (!table.rows[0].exists) return { exists: false, rows: [] };
  const result = await client.query<AppliedMigration>(
    "SELECT version, name, checksum FROM public.schema_migrations ORDER BY version",
  );
  return { exists: true, rows: result.rows };
}

async function assertNoUntrackedSchema(client: MigrationClient): Promise<void> {
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    ) AS exists
  `);
  if (result.rows[0].exists) {
    throw new Error(
      "Public schema has tables but no recognized migration history; refusing to run migrations.",
    );
  }
}

async function ensureMigrationTable(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function getMigrationStatus(client: MigrationClient) {
  const snapshot = await readLedger(client);
  if (!snapshot.exists || snapshot.rows.length === 0) {
    await assertNoUntrackedSchema(client);
  }
  return getMigrationStatuses(snapshot.rows);
}

export async function runMigrations(
  client: MigrationClient,
  log: (message: string) => void = console.log,
): Promise<{ lineage: "remote" | "legacy-local"; applied: number; pending: number }> {
  const snapshot = await readLedger(client);
  if (!snapshot.exists || snapshot.rows.length === 0) {
    await assertNoUntrackedSchema(client);
  }

  // This validates every applied row before creating the ledger or running DDL.
  const lineage = resolveMigrationLineage(snapshot.rows);
  const appliedVersions = new Set(snapshot.rows.map((row) => row.version));
  if (!snapshot.exists) await ensureMigrationTable(client);

  let applied = 0;
  let pending = 0;
  for (const migration of lineage.migrations) {
    if (appliedVersions.has(migration.version)) {
      log(`Already applied: ${migration.version} ${migration.name}`);
      continue;
    }
    pending += 1;
    await client.query("BEGIN");
    try {
      await migration.up(client);
      await client.query(
        "INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, migrationChecksum(migration)],
      );
      await client.query("COMMIT");
      applied += 1;
      log(`Applied: ${migration.version} ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  return { lineage: lineage.id, applied, pending: 0 };
}

export async function printMigrationStatus(
  client: MigrationClient,
  log: (message: string) => void = console.log,
): Promise<void> {
  const result = await getMigrationStatus(client);
  log(`Lineage: ${result.lineage}`);
  for (const migration of result.migrations) {
    log(`${migration.status}: ${migration.version} ${migration.name}`);
  }
}
