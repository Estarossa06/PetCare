import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadDatabaseUrl } from "../config/env.js";

async function main(): Promise<void> {
  if (process.env.PETCARE_RUN_DB_CHECKS !== "1") {
    throw new Error(
      "Refusing database verification without PETCARE_RUN_DB_CHECKS=1. Use a disposable development database.",
    );
  }
  const connectionString = loadDatabaseUrl();
  const pool = new Pool({ connectionString, max: 2 });
  const first = await pool.connect();
  const second = await pool.connect();
  let ownerId: string | undefined;
  let firstInTransaction = false;
  let secondInTransaction = false;
  try {
    ownerId = randomUUID();
    const entityId = randomUUID();
    await first.query("BEGIN");
    firstInTransaction = true;
    await first.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'verification-hash', 'Cursor verification')",
      [ownerId, `${ownerId}@example.invalid`],
    );

    await first.query(
      `INSERT INTO sync_cursors (owner_id, last_cursor)
       VALUES ($1, 1)
       ON CONFLICT (owner_id) DO UPDATE
       SET last_cursor = sync_cursors.last_cursor + EXCLUDED.last_cursor`,
      [ownerId],
    );
    await first.query(
      `INSERT INTO sync_changes
        (owner_id, cursor, entity_type, entity_id, entity_version, operation_id, change_type)
       VALUES ($1, 1, 'pet', $2, 1, NULL, 'upsert')`,
      [ownerId, entityId],
    );

    const backend = await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await second.query("BEGIN");
    secondInTransaction = true;
    const secondAllocation = second.query<{ last_cursor: string }>(
      `INSERT INTO sync_cursors (owner_id, last_cursor)
       VALUES ($1, 1)
       ON CONFLICT (owner_id) DO UPDATE
       SET last_cursor = sync_cursors.last_cursor + EXCLUDED.last_cursor
       RETURNING last_cursor`,
      [ownerId],
    );
    let waitingForCounterLock = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const activity = await first.query<{ wait_event_type: string | null }>(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
        [backend.rows[0].pid],
      );
      if (activity.rows[0]?.wait_event_type === "Lock") {
        waitingForCounterLock = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!waitingForCounterLock) {
      throw new Error("Second transaction did not wait for the owner cursor row lock.");
    }
    const beforeFirstCommit = await first.query<{ cursor: string }>(
      "SELECT cursor FROM sync_changes WHERE owner_id = $1 ORDER BY cursor",
      [ownerId],
    );
    if (beforeFirstCommit.rows.length !== 1 || beforeFirstCommit.rows[0].cursor !== "1") {
      throw new Error("First transaction did not reserve the expected cursor.");
    }

    await first.query("COMMIT");
    firstInTransaction = false;
    const allocated = await secondAllocation;
    if (allocated.rows[0]?.last_cursor !== "2") {
      throw new Error("Second transaction did not receive the next committed cursor.");
    }
    await second.query(
      `INSERT INTO sync_changes
        (owner_id, cursor, entity_type, entity_id, entity_version, operation_id, change_type)
       VALUES ($1, $2, 'pet', $3, 1, NULL, 'upsert')`,
      [ownerId, allocated.rows[0].last_cursor, randomUUID()],
    );
    await second.query("COMMIT");
    secondInTransaction = false;

    const result = await first.query<{ cursor: string }>(
      "SELECT cursor FROM sync_changes WHERE owner_id = $1 ORDER BY cursor",
      [ownerId],
    );
    if (
      result.rows.length !== 2 ||
      result.rows[0].cursor !== "1" ||
      result.rows[1].cursor !== "2"
    ) {
      throw new Error("Concurrent cursor transactions produced a gap or reordering.");
    }
    console.log("Passed: concurrent committed feed cursors are ordered without skipped events.");
  } catch (error) {
    if (firstInTransaction) {
      await first.query("ROLLBACK");
      firstInTransaction = false;
    }
    if (secondInTransaction) {
      await second.query("ROLLBACK");
      secondInTransaction = false;
    }
    throw error;
  } finally {
    try {
      if (ownerId) {
        await first.query("BEGIN");
        await first.query("DELETE FROM sync_changes WHERE owner_id = $1", [ownerId]);
        await first.query("DELETE FROM sync_cursors WHERE owner_id = $1", [ownerId]);
        await first.query("DELETE FROM users WHERE id = $1", [ownerId]);
        await first.query("COMMIT");
        const remainingFixtures = await first.query<{ remaining: number }>(
          `SELECT (
            (SELECT count(*) FROM users WHERE id = $1) +
            (SELECT count(*) FROM sync_cursors WHERE owner_id = $1) +
            (SELECT count(*) FROM sync_changes WHERE owner_id = $1)
          )::int AS remaining`,
          [ownerId],
        );
        if (remainingFixtures.rows[0]?.remaining !== 0) {
          throw new Error("Cursor verifier fixtures remained after cleanup.");
        }
        console.log("Passed: cursor verifier fixtures were removed.");
      }
    } finally {
      first.release();
      second.release();
      await pool.end();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected cursor verification failure.";
  console.error(`Cursor verification failed: ${message}`);
  process.exitCode = 1;
});
