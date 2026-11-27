import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const compiledRoot = resolve(dirname(fileURLToPath(import.meta.url)), process.env.PETCARE_COMPILED_API_DIR ?? "../dist");
const [{ legacyLocalMigrations, migrations: remoteMigrations }, { getMigrationStatuses, migrationChecksum, resolveMigrationLineage }, { runMigrations }] = await Promise.all([
  import(pathToFileURL(resolve(compiledRoot, "db/migrations/index.js")).href),
  import(pathToFileURL(resolve(compiledRoot, "db/migration-lineage.js")).href),
  import(pathToFileURL(resolve(compiledRoot, "db/migration-runner.js")).href),
]);

function rowsFor(migrations) {
  return migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    checksum: migrationChecksum(migration),
  }));
}

function passed(name) {
  process.stdout.write(`PASS ${name}\n`);
}

const localRows = rowsFor(legacyLocalMigrations.slice(0, 11));
const localPlan = resolveMigrationLineage(localRows);
assert.equal(localPlan.id, "legacy-local");
assert.deepEqual(
  getMigrationStatuses(localRows).migrations.filter((item) => item.status === "Pending").map((item) => item.version),
  [12, 13, 14, 15, 16],
);
assert.equal(localPlan.migrations[11].name, "pet_tracking");
passed("existing local ledger selects legacy lineage and leaves tracking v12 pending");

const remoteRows = rowsFor(remoteMigrations.slice(0, 5));
const remotePlan = resolveMigrationLineage(remoteRows);
assert.equal(remotePlan.id, "remote");
assert.deepEqual(
  getMigrationStatuses(remoteRows).migrations.filter((item) => item.status === "Pending").map((item) => item.version),
  [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
);
passed("existing remote ledger selects merged lineage and reports migrations 6-16 pending");

assert.equal(resolveMigrationLineage([]).id, "remote");
assert.equal(getMigrationStatuses([]).migrations.length, 16);
assert.equal(getMigrationStatuses([]).migrations.every((item) => item.status === "Pending"), true);
passed("new database defaults to remote lineage with every migration pending");

const mixedRows = [...localRows.slice(0, 5), rowsFor(remoteMigrations.slice(5, 6))[0]];
assert.throws(() => resolveMigrationLineage(mixedRows), /does not match|not a contiguous/);
const badChecksum = [...localRows.slice(0, 5)];
badChecksum[4] = { ...badChecksum[4], checksum: "0".repeat(64) };
assert.throws(() => resolveMigrationLineage(badChecksum), /name and checksum/);
assert.throws(() => resolveMigrationLineage([...localRows, { version: 17, name: "unknown", checksum: "x" }]), /unknown version/);
passed("mixed, corrupt-checksum, and unknown histories are rejected");

class FakeLedgerClient {
  ledgerExists = false;
  rows = [];
  writes = [];
  lockDepth = 0;
  lockCalls = 0;

  async query(sql, values = []) {
    const normalized = String(sql).trim().replace(/\s+/g, " ");
    if (normalized.startsWith("SELECT to_regclass")) {
      return { rows: [{ exists: this.ledgerExists }] };
    }
    if (normalized.startsWith("SELECT version, name, checksum FROM public.schema_migrations")) {
      return { rows: [...this.rows] };
    }
    if (normalized.startsWith("SELECT pg_advisory_lock")) {
      this.lockDepth += 1;
      this.lockCalls += 1;
      return { rows: [{ pg_advisory_lock: null }] };
    }
    if (normalized.startsWith("SELECT pg_advisory_unlock")) {
      this.lockDepth -= 1;
      return { rows: [{ pg_advisory_unlock: true }] };
    }
    if (normalized.startsWith("SELECT pg_advisory")) {
      return { rows: [{ pg_advisory_lock: null }] };
    }
    if (normalized.startsWith("SELECT EXISTS")) return { rows: [{ exists: false }] };
    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS public.schema_migrations")) {
      this.ledgerExists = true;
      this.writes.push("create-ledger");
      return { rows: [] };
    }
    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO public.schema_migrations")) {
      this.rows.push({ version: values[0], name: values[1], checksum: values[2] });
      this.writes.push(`ledger:${values[0]}`);
      return { rows: [], rowCount: 1 };
    }
    this.writes.push("migration-ddl");
    return { rows: [] };
  }
}

const existingLocalDb = new FakeLedgerClient();
existingLocalDb.ledgerExists = true;
existingLocalDb.rows = localRows.map((row) => ({ ...row }));
await runMigrations(existingLocalDb, () => {});
assert.deepEqual(existingLocalDb.rows.map((row) => row.version), [...Array(16)].map((_, index) => index + 1));
assert.equal(existingLocalDb.lockDepth, 0);
assert.equal(existingLocalDb.lockCalls, 1);
const writesAfterFirstRun = [...existingLocalDb.writes];
await runMigrations(existingLocalDb, () => {});
assert.deepEqual(existingLocalDb.writes, writesAfterFirstRun);
passed("legacy tracking migration applies once; a second run creates no duplicate ledger rows or DDL");

const newDb = new FakeLedgerClient();
await runMigrations(newDb, () => {});
assert.equal(newDb.rows.length, 16);
const newDbWrites = [...newDb.writes];
await runMigrations(newDb, () => {});
assert.deepEqual(newDb.writes, newDbWrites);
passed("new remote database applies once; a second run makes no migration writes");

const invalidDb = new FakeLedgerClient();
invalidDb.ledgerExists = true;
invalidDb.rows = mixedRows.map((row) => ({ ...row }));
await assert.rejects(runMigrations(invalidDb, () => {}), /does not match|not a contiguous/);
assert.deepEqual(invalidDb.writes, []);
assert.equal(invalidDb.lockDepth, 0);
passed("invalid history is rejected before DDL or ledger writes");
