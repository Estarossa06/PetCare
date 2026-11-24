import { createHash } from "node:crypto";
import type { Migration } from "./migrations/types.js";
import { legacyLocalMigrations, migrations } from "./migrations/index.js";

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

export interface MigrationLineage {
  id: "remote" | "legacy-local";
  migrations: Migration[];
}

export interface MigrationStatus {
  version: number;
  name: string;
  status: "Applied" | "Pending";
}

export const migrationLineages: MigrationLineage[] = [
  { id: "remote", migrations },
  { id: "legacy-local", migrations: legacyLocalMigrations },
];

export function migrationChecksum(migration: Migration): string {
  return createHash("sha256").update(migration.up.toString()).digest("hex");
}

function sameIdentity(row: AppliedMigration, migration: Migration): boolean {
  return row.name === migration.name && row.checksum === migrationChecksum(migration);
}

function assertContiguousVersions(applied: AppliedMigration[]): void {
  const seen = new Set<number>();
  for (const row of applied) {
    if (!Number.isSafeInteger(row.version) || row.version < 1 || seen.has(row.version)) {
      throw new Error(`Invalid or duplicate migration ledger version ${row.version}.`);
    }
    seen.add(row.version);
  }
}

/** Selects and fully validates one known, contiguous ledger before any DDL runs. */
export function resolveMigrationLineage(
  rows: readonly AppliedMigration[],
): MigrationLineage {
  const applied = [...rows].sort((a, b) => a.version - b.version);
  assertContiguousVersions(applied);

  let selected = migrationLineages[0]; // New databases use the merged remote lineage.
  const marker = applied.find((row) => row.version === 5);
  if (marker) {
    const candidates = migrationLineages.filter((lineage) => {
      const migration = lineage.migrations.find((item) => item.version === 5);
      return migration !== undefined && sameIdentity(marker, migration);
    });
    if (candidates.length !== 1) {
      throw new Error(
        "Migration ledger version 5 does not match a known lineage name and checksum; refusing to continue.",
      );
    }
    selected = candidates[0];
  }

  if (applied.length > selected.migrations.length) {
    throw new Error(`Migration ledger contains unknown version ${applied.at(-1)?.version}.`);
  }
  const highestKnownVersion = selected.migrations.at(-1)?.version ?? 0;
  const unknownRow = applied.find((row) => row.version > highestKnownVersion);
  if (unknownRow) {
    throw new Error(`Migration ledger contains unknown version ${unknownRow.version}.`);
  }

  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index];
    const expected = selected.migrations[index];
    if (!expected || row.version !== expected.version) {
      throw new Error(
        `Migration ledger is not a contiguous ${selected.id} history at version ${row.version}; refusing to continue.`,
      );
    }
    if (!sameIdentity(row, expected)) {
      throw new Error(
        `Migration ${row.version} (${row.name}) does not match the ${selected.id} ledger name/checksum; refusing to continue.`,
      );
    }
  }

  return selected;
}

export function getMigrationStatuses(
  rows: readonly AppliedMigration[],
): { lineage: MigrationLineage["id"]; migrations: MigrationStatus[] } {
  const lineage = resolveMigrationLineage(rows);
  const appliedVersions = new Set(rows.map((row) => row.version));
  return {
    lineage: lineage.id,
    migrations: lineage.migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
      status: appliedVersions.has(migration.version) ? "Applied" : "Pending",
    })),
  };
}
