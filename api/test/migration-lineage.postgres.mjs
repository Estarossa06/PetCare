import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import pg from "pg";
import { legacyLocalMigrations, migrations as remoteMigrations } from "../src/db/migrations/index.ts";
import { migrationChecksum } from "../src/db/migration-lineage.ts";
import { getMigrationStatus, runMigrations } from "../src/db/migration-runner.ts";

const { Client } = pg;
const baseUrlValue = process.env.PETCARE_TEST_DATABASE_URL;
if (!baseUrlValue) throw new Error("PETCARE_TEST_DATABASE_URL must target the disposable test database.");
const baseUrl = new URL(baseUrlValue);
if (!/^\/?petcare_test$/.test(baseUrl.pathname)) {
  throw new Error("Refusing to create migration test databases unless the configured database is exactly petcare_test.");
}

const created = new Set();
const prefix = `petcare_test_mig_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const databaseNames = ["local", "remote", "fresh", "mixed", "checksum"].map((suffix) => `${prefix}_${suffix}`);

function dbUrl(name) {
  const url = new URL(baseUrlValue);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withClient(url, action) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function createTestDatabase(admin, name) {
  if (!/^petcare_test_mig_[a-f0-9]{12}_[a-z]+$/.test(name)) throw new Error("Unsafe test database name.");
  await admin.query(`CREATE DATABASE "${name}"`);
  created.add(name);
}

async function createLedgerOnly(client, rows) {
  await client.query(`CREATE TABLE public.schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL, checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const row of rows) {
    await client.query("INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)", [row.version,row.name,row.checksum]);
  }
}

async function applyHistory(client, list) {
  await createLedgerOnly(client, []);
  for (const migration of list) {
    await client.query("BEGIN");
    try {
      await migration.up(client);
      await client.query("INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)", [migration.version,migration.name,migrationChecksum(migration)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

const admin = new Client({ connectionString: baseUrlValue });
await admin.connect();
try {
  const target = await admin.query("SELECT current_database() AS database");
  if (target.rows[0].database !== "petcare_test") throw new Error("Connection target changed; refusing test database creation.");

  for (const name of databaseNames) await createTestDatabase(admin, name);

  await withClient(dbUrl(databaseNames[0]), async (client) => {
    await applyHistory(client, legacyLocalMigrations.slice(0, 11));
    const status = await getMigrationStatus(client);
    assert.equal(status.lineage, "legacy-local");
    assert.deepEqual(status.migrations.filter((m) => m.status === "Pending").map((m) => m.version), [12,13]);
    await runMigrations(client, () => {});
    const after = await client.query("SELECT version,name FROM public.schema_migrations ORDER BY version");
    assert.equal(after.rows.length, 13);
    assert.deepEqual(after.rows.at(-1), { version: 12, name: "pet_tracking" });
    await runMigrations(client, () => {});
    const rerun = await client.query("SELECT version,name,checksum FROM public.schema_migrations ORDER BY version");
    assert.equal(rerun.rows.length, 13);
    assert.deepEqual(rerun.rows.map((row) => row.version), after.rows.map((row) => row.version));
  });
  process.stdout.write("PASS PostgreSQL existing local lineage upgrades with tracking at v12\n");

  await withClient(dbUrl(databaseNames[1]), async (client) => {
    await applyHistory(client, remoteMigrations.slice(0, 5));
    const status = await getMigrationStatus(client);
    assert.equal(status.lineage, "remote");
    assert.deepEqual(status.migrations.filter((m) => m.status === "Pending").map((m) => m.version), [6,7,8,9,10,11,12,13]);
    await runMigrations(client, () => {});
    const before = await client.query("SELECT version,name,checksum FROM public.schema_migrations ORDER BY version");
    await runMigrations(client, () => {});
    const after = await client.query("SELECT version,name,checksum FROM public.schema_migrations ORDER BY version");
    assert.deepEqual(after.rows, before.rows);
    assert.equal(after.rows.length, 13);
  });
  process.stdout.write("PASS PostgreSQL existing remote lineage continues 6-13 and reruns without duplicates\n");

  await withClient(dbUrl(databaseNames[2]), async (client) => {
    let status = await getMigrationStatus(client);
    assert.equal(status.lineage, "remote");
    assert.equal(status.migrations.filter((m) => m.status === "Pending").length, 13);
    await runMigrations(client, () => {});
    const before = await client.query("SELECT version,name,checksum FROM public.schema_migrations ORDER BY version");
    await runMigrations(client, () => {});
    const after = await client.query("SELECT version,name,checksum FROM public.schema_migrations ORDER BY version");
    assert.deepEqual(after.rows, before.rows);
    assert.equal(after.rows.length, 13);
  });
  process.stdout.write("PASS PostgreSQL new database applies remote lineage once\n");

  const localPrefix = legacyLocalMigrations.slice(0, 5).map((migration) => ({ version:migration.version,name:migration.name,checksum:migrationChecksum(migration) }));
  const mixed = [...localPrefix, { version:6, name:remoteMigrations[5].name, checksum:migrationChecksum(remoteMigrations[5]) }];
  await withClient(dbUrl(databaseNames[3]), async (client) => {
    await createLedgerOnly(client, mixed);
    await assert.rejects(runMigrations(client, () => {}), /does not match|not a contiguous/);
    const count = await client.query("SELECT count(*)::int AS count FROM public.schema_migrations");
    const appTables = await client.query("SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'");
    assert.equal(count.rows[0].count, mixed.length);
    assert.equal(appTables.rows[0].count, 0);
  });
  process.stdout.write("PASS PostgreSQL mixed history is rejected before schema changes\n");

  const bad = localPrefix.map((row) => ({ ...row }));
  bad[4].checksum = "0".repeat(64);
  await withClient(dbUrl(databaseNames[4]), async (client) => {
    await createLedgerOnly(client, bad);
    await assert.rejects(runMigrations(client, () => {}), /name and checksum/);
    const count = await client.query("SELECT count(*)::int AS count FROM public.schema_migrations");
    const appTables = await client.query("SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'");
    assert.equal(count.rows[0].count, bad.length);
    assert.equal(appTables.rows[0].count, 0);
  });
  process.stdout.write("PASS PostgreSQL wrong checksum is rejected before schema changes\n");
} finally {
  for (const name of created) {
    if (!/^petcare_test_mig_[a-f0-9]{12}_[a-z]+$/.test(name)) continue;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  await admin.end();
}
