import "dotenv/config";
import { Pool } from "pg";
import { loadDatabaseUrl } from "../config/env.js";
import { printMigrationStatus, runMigrations } from "./migration-runner.js";

const lockId = 872_411_026;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadDatabaseUrl() });
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockId]);
    locked = true;
    const action = process.argv[2] ?? "up";
    if (action === "up") {
      const result = await runMigrations(client);
      console.log(`Lineage: ${result.lineage}`);
      console.log(`Applied ${result.applied} migration(s); ${result.pending} pending.`);
    } else if (action === "status") {
      await printMigrationStatus(client);
    } else {
      throw new Error(`Unknown migration command "${action}". Use "up" or "status".`);
    }
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected migration failure.";
  console.error(`Database migration failed: ${message}`);
  process.exitCode = 1;
});
