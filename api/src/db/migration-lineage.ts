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

// Before checksum canonicalization the runner hashed Function#toString().
// tsx/source and compiled Node builds emitted different whitespace and line
// endings, so retain both historical digests without rewriting old ledgers.
const legacyRuntimeChecksums: Record<string, readonly string[]> = {
  core: ["2036effb8873308f5f385e1b468afbae56aa99bca4710013ffcc4dd0d375f5a3", "9cc9ea1f96acd69f8d1e7370c1349bf7580fd33fe921b1f1870dd47bb39b520a"],
  sync_support: ["f90c77ab1ba68da5a4fb99a7cfb66f9a28500b852dbda5600f4ba9e360b5e89c", "e49725f2581e3f4b742ee641954e8e23e8e65bdc4830a1dac85cb40dccd8c65e"],
  ordered_sync_cursors: ["d7379f8365e5c36c772ff9ab5f159412d5f72dbbaf7e21a94caa4bbafaa62ddb", "ad98f2f36cedc9ef03a9062961bf7dc729980dbd03649b36ac1780e891d18af6"],
  auth_refresh_token_history: ["dfd4f5469c8d14561e6f88eb11a002b5941c3e3c9b47abbbb9c5aeb2b1ba23ec", "745b80419207baf4705045ee80e59c9915ae8038cc51d09d10990c41feb777e1"],
  pet_tracking: ["b7b404c2e371b7256d368f4798f47035983751e9c2a2fbc49d1c8f535c27555c", "8227ff9191296a2d065fd39a760064735fea9ff67f5e7f3c1d07da3438378d4b"],
  pet_sync_protocol: ["6c735b944fcfe2954a91f5972fa3d3735f917f5fbcab51ba916c8bab1b41b2be", "223ef24efebf683208666109b2701b4664c12240c68a04b1ea5293aa93a5fa6e"],
  domain_sync_entities: ["9c34e333cdce8266856eec3864cdb1b7d4ff2e176f212eada5ef1a6521ec1af4", "c62f3e5d6b33be3edd784605efbeb85f93fe430c61e3f860ba8ac01e65a5ec53"],
  domain_sync_legacy_category_backfill: ["ea69c5d9763193c41e4a2e4d79eeb2b7603695004d5bfdc49602f87075a9e714", "8f70619ec965a01d1ed6148c14720689ce857f9da9aadc39c8f946e7b909ed32"],
  preserve_existing_sync_entity_types: ["080ec047ee266e3f0f0f0b384000ea4ad7cb40f6cf5dfeaf014e18a8992a7970", "d40a31cecf211211aeaa7a70774426d1491377f9289a990ce4772047b0f20b9d"],
  account_lifecycle: ["4da39d7747a68de780de9007f19e2347a38c28997cfe4ff1aee63abb51f2dc59", "ba3db7f997625255a28dfe0c53821876705552e5c4c25a259ef39ed12a5a5a06"],
  kirai_conversations: ["b041ced165e3815e969e934b676b5442da60d426b99cbedd587819687c81e821", "3c470bebe973ce6ad830b131095ce031dd2995e7718d09eb58b1257894672c96"],
  media_storage: ["8244e5a25dfb9559f937dec729c80c79f80897a4b3493c40a174268c47834ec0", "e7bf9c1a294195cd1db9e833a75af1be96eeacae2544a9c929e9dfbef68cbeda"],
  account_deletion_worker: ["1e91cb83533937bc417a06ddb8f57a0c977c813d0ab45c22910593cdd1b5123c", "d332684edac9f738b509806d1f4d78f807b21508f20f79812018c64349d4f760"],
  google_oauth_identities: ["ceeff5f287b31a8972d158732123c15992a06f282ed91723425b0b36d88ca2ab", "216dfcf12e6a30b9b21460671683337d6eb19afb3b6ba7063035e4106a2aca3d"],
};

export function canonicalMigrationSource(source: string): string {
  let result = "";
  let inTemplate = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!inTemplate) {
      if (character === "`") {
        inTemplate = true;
        result += character;
      } else if (!/\s/.test(character)) {
        result += character;
      }
      continue;
    }
    if (character === "\r") {
      result += "\n";
      if (source[index + 1] === "\n") index += 1;
      continue;
    }
    result += character;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === "`") inTemplate = false;
  }
  // TypeScript emits statement semicolons in the compiled function while
  // tsx preserves the source's optional semicolon after a SQL template call.
  return result.replace(/`\);/g, "`)");
}

function rawMigrationChecksum(migration: Migration): string {
  return createHash("sha256").update(migration.up.toString()).digest("hex");
}

export function migrationChecksum(migration: Migration): string {
  return createHash("sha256").update(canonicalMigrationSource(migration.up.toString())).digest("hex");
}

export function migrationChecksumCandidates(migration: Migration): string[] {
  const rawChecksum = rawMigrationChecksum(migration);
  const legacy = legacyRuntimeChecksums[migration.name] ?? [];
  return [...new Set([
    migrationChecksum(migration),
    rawChecksum,
    ...(legacy.includes(rawChecksum) ? legacy : []),
  ])];
}

function sameIdentity(row: AppliedMigration, migration: Migration): boolean {
  if (row.name !== migration.name) return false;
  return migrationChecksumCandidates(migration).includes(row.checksum);
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
