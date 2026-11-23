import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { loadDatabaseUrl } from "../config/env.js";

type Test = {
  name: string;
  run(client: PoolClient): Promise<void>;
};

async function verifySchema(client: PoolClient): Promise<void> {
  const expectedTables = [
    "users",
    "auth_sessions",
    "pets",
    "health_records",
    "health_attachments",
    "care_tasks",
    "appointments",
    "reminders",
    "ai_conversations",
    "ai_messages",
    "sync_devices",
    "sync_operations",
    "sync_changes",
    "sync_cursors",
    "schema_migrations",
  ];
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const actualTables = new Set(tables.rows.map(({ table_name }) => table_name));
  const missingTables = expectedTables.filter((table) => !actualTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Missing PostgreSQL tables: ${missingTables.join(", ")}.`);
  }

  const expectedIndexes = [
    "users_email_unique_idx",
    "pets_owner_updated_idx",
    "health_records_pet_date_idx",
    "sync_devices_user_active_idx",
    "sync_changes_entity_idx",
  ];
  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  const actualIndexes = new Set(indexes.rows.map(({ indexname }) => indexname));
  const missingIndexes = expectedIndexes.filter((index) => !actualIndexes.has(index));
  if (missingIndexes.length > 0) {
    throw new Error(`Missing PostgreSQL indexes: ${missingIndexes.join(", ")}.`);
  }

  const constraints = await client.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace`,
  );
  const actualConstraints = new Set(constraints.rows.map(({ conname }) => conname));
  const expectedConstraints = [
    "health_records_pet_owner_fk",
    "sync_operations_pkey",
    "sync_changes_pkey",
    "sync_cursors_last_cursor_nonnegative",
  ];
  const missingConstraints = expectedConstraints.filter(
    (constraint) => !actualConstraints.has(constraint),
  );
  if (missingConstraints.length > 0) {
    throw new Error(`Missing PostgreSQL constraints: ${missingConstraints.join(", ")}.`);
  }
}

async function expectSqlState(
  client: PoolClient,
  name: string,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_failure");
  try {
    await action();
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    await client.query("RELEASE SAVEPOINT expected_failure");
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === code
    ) {
      return;
    }
    const actualCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unknown";
    throw new Error(`${name}: unexpected database SQLSTATE ${actualCode}.`);
  }
  await client.query("ROLLBACK TO SAVEPOINT expected_failure");
  await client.query("RELEASE SAVEPOINT expected_failure");
  throw new Error(`${name}: expected database error ${code}, but the statement succeeded.`);
}

async function run(): Promise<void> {
  if (process.env.PETCARE_RUN_DB_CHECKS !== "1") {
    throw new Error(
      "Refusing database verification without PETCARE_RUN_DB_CHECKS=1. Use a disposable development database.",
    );
  }
  const connectionString = loadDatabaseUrl();
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await verifySchema(client);
    console.log("Passed: expected PostgreSQL tables, indexes, and constraints exist");

    const ownerId = randomUUID();
    const otherOwnerId = randomUUID();
    const petId = randomUUID();
    const healthId = randomUUID();
    const operationId = randomUUID();
    const now = new Date().toISOString();
    const tests: Test[] = [
      {
        name: "shared UUID persistence",
        async run(connection) {
          const result = await connection.query<{ id: string }>(
            `INSERT INTO pets (id, owner_id, name, species)
             VALUES ($1, $2, 'Verification pet', 'dog') RETURNING id`,
            [petId, ownerId],
          );
          if (result.rows[0].id !== petId) {
            throw new Error("UUID did not round-trip unchanged.");
          }
        },
      },
      {
        name: "invalid UUID rejection",
        async run(connection) {
          await connection.query(
            `INSERT INTO pets (id, owner_id, name, species)
             VALUES ('not-a-uuid', $1, 'Invalid UUID', 'dog')`,
            [ownerId],
          );
        },
      },
      {
        name: "owner relationship isolation",
        async run(connection) {
          await connection.query(
            `INSERT INTO health_records
              (id, owner_id, pet_id, record_type, title, occurred_at)
             VALUES ($1, $2, $3, 'observation', 'Isolation check', $4)`,
            [healthId, otherOwnerId, petId, now],
          );
        },
      },
      {
        name: "version check constraint",
        async run(connection) {
          await connection.query(
            "UPDATE pets SET version = 0 WHERE id = $1",
            [petId],
          );
        },
      },
      {
        name: "idempotency operation key uniqueness",
        async run(connection) {
          await connection.query(
            `INSERT INTO sync_operations (user_id, operation_id, request_hash, response)
             VALUES ($1, $2, $3, '{"accepted":true}'::jsonb)`,
            [ownerId, operationId, "a".repeat(64)],
          );
          await expectSqlState(connection, "duplicate idempotency key", "23505", () =>
            connection.query(
              `INSERT INTO sync_operations (user_id, operation_id, request_hash, response)
               VALUES ($1, $2, $3, '{"accepted":true}'::jsonb)`,
              [ownerId, operationId, "a".repeat(64)],
            ),
          );
        },
      },
      {
        name: "soft deletion preserves the row",
        async run(connection) {
          await connection.query(
            "UPDATE pets SET deleted_at = now(), version = version + 1 WHERE id = $1",
            [petId],
          );
          const result = await connection.query<{ deleted_at: Date | null; version: number }>(
            "SELECT deleted_at, version FROM pets WHERE id = $1",
            [petId],
          );
          if (!result.rows[0]?.deleted_at || result.rows[0].version !== 2) {
            throw new Error("Soft-deleted row or version was not retained.");
          }
          await connection.query(
            `INSERT INTO health_records
              (id, owner_id, pet_id, record_type, title, occurred_at)
             VALUES ($1, $2, $3, 'observation', 'Delete restriction check', $4)`,
            [healthId, ownerId, petId, now],
          );
        },
      },
    ];

    await client.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'verification-hash', 'Verification')",
      [ownerId, `${ownerId}@example.invalid`],
    );
    await client.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'verification-hash', 'Other verification')",
      [otherOwnerId, `${otherOwnerId}@example.invalid`],
    );

    for (const test of tests) {
      if (test.name === "invalid UUID rejection") {
        await expectSqlState(client, test.name, "22P02", () => test.run(client));
      } else if (test.name === "owner relationship isolation") {
        await expectSqlState(client, test.name, "23503", () => test.run(client));
      } else if (test.name === "version check constraint") {
        await expectSqlState(client, test.name, "23514", () => test.run(client));
      } else {
        await test.run(client);
      }
      console.log(`Passed: ${test.name}`);
    }

    await expectSqlState(client, "physical delete restriction", "23001", () =>
      client.query("DELETE FROM pets WHERE id = $1", [petId]),
    );
    console.log("Passed: physical delete restriction");
    await client.query("ROLLBACK");
    const remainingFixtures = await client.query<{ remaining: number }>(
      `SELECT (
        (SELECT count(*) FROM users WHERE id = ANY($1::uuid[])) +
        (SELECT count(*) FROM pets WHERE id = $2) +
        (SELECT count(*) FROM health_records WHERE id = $3) +
        (SELECT count(*) FROM sync_operations WHERE user_id = $4 AND operation_id = $5)
      )::int AS remaining`,
      [[ownerId, otherOwnerId], petId, healthId, ownerId, operationId],
    );
    if (remainingFixtures.rows[0]?.remaining !== 0) {
      throw new Error("PostgreSQL verifier fixtures remained after transaction rollback.");
    }
    console.log("Passed: verifier fixtures were rolled back.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected verification failure.";
  console.error(`Database verification failed: ${message}`);
  process.exitCode = 1;
});
