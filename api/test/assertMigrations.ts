import assert from "node:assert/strict";
import type { Queryable } from "../src/db/queryable.js";
import { getMigrationStatus } from "../src/db/migration-runner.js";

export async function assertMigrationsApplied(
  database: Queryable,
  requiredNames: readonly string[],
): Promise<void> {
  const status = await getMigrationStatus(database);
  for (const name of requiredNames) {
    assert.equal(
      status.migrations.find((migration) => migration.name === name)?.status,
      "Applied",
      `Required migration ${name} is not applied in the ${status.lineage} lineage.`,
    );
  }
}
