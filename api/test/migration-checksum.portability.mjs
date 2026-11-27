import assert from "node:assert/strict";
import { legacyLocalMigrations as sourceLegacy, migrations as sourceMigrations } from "../src/db/migrations/index.ts";
import { canonicalMigrationSource, migrationChecksum, migrationChecksumCandidates, resolveMigrationLineage } from "../src/db/migration-lineage.ts";
import { legacyLocalMigrations as compiledLegacy, migrations as compiledMigrations } from "../dist/db/migrations/index.js";

for (let index = 0; index < sourceMigrations.length; index += 1) {
  const source = canonicalMigrationSource(sourceMigrations[index].up.toString());
  const compiled = canonicalMigrationSource(compiledMigrations[index].up.toString());
  if (source !== compiled) {
    let offset = 0;
    while (offset < source.length && source[offset] === compiled[offset]) offset += 1;
    assert.fail(`Migration ${index + 1} differs at ${offset} (lengths ${source.length}/${compiled.length}): ${JSON.stringify(source.slice(offset - 20, offset + 30))} vs ${JSON.stringify(compiled.slice(offset - 20, offset + 30))}`);
  }
  assert.equal(migrationChecksum(sourceMigrations[index]), migrationChecksum(compiledMigrations[index]));
  const sourceCandidates = migrationChecksumCandidates(sourceMigrations[index]);
  const compiledCandidates = migrationChecksumCandidates(compiledMigrations[index]);
  assert.equal(sourceCandidates[0], compiledCandidates[0]);
  // Historical migrations retain their known runtime digests; a newly added
  // migration has no legacy raw digest and only its canonical checksum must
  // be stable across tsx and compiled execution.
  if (index < 13) assert.deepEqual(new Set(sourceCandidates), new Set(compiledCandidates));
}
const persistedChecksum = (migration, index) => migrationChecksumCandidates(migration)[index < 13 ? 1 : 0];
const sourceRemoteLedger = sourceMigrations.map((migration, index) => ({
  version: migration.version, name: migration.name, checksum: persistedChecksum(migration, index),
}));
const compiledRemoteLedger = compiledMigrations.map((migration, index) => ({
  version: migration.version, name: migration.name, checksum: persistedChecksum(migration, index),
}));
const sourceLocalLedger = sourceLegacy.map((migration, index) => ({
  version: migration.version, name: migration.name, checksum: persistedChecksum(migration, index),
}));
const compiledLocalLedger = compiledLegacy.map((migration, index) => ({
  version: migration.version, name: migration.name, checksum: persistedChecksum(migration, index),
}));
assert.equal(resolveMigrationLineage(sourceRemoteLedger).id, "remote");
assert.equal(resolveMigrationLineage(compiledRemoteLedger).id, "remote");
assert.equal(resolveMigrationLineage(sourceLocalLedger).id, "legacy-local");
assert.equal(resolveMigrationLineage(compiledLocalLedger).id, "legacy-local");
process.stdout.write(`PASS source/compiled checksum portability for ${sourceMigrations.length} migrations\n`);
