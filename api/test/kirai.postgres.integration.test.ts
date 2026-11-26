import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabasePool } from "../src/db/pool.js";
import { assertMigrationsApplied } from "./assertMigrations.js";
import { loadRemotePetContext } from "../src/modules/kirai/petContext.js";
import { KiraiNotFoundError, PostgresKiraiStore } from "../src/modules/kirai/repository.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.PETCARE_RUN_KIRAI_DB_TESTS === "1";

test("KIRAI PostgreSQL context, persistence and owner isolation use petcare_test", {
  skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_KIRAI_DB_TESTS=1 for petcare_test.",
}, async () => {
  const parsed = new URL(databaseUrl!);
  assert.ok(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:");
  assert.equal(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "petcare_test");
  const pool = createDatabasePool(databaseUrl!);
  const runId = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const petA = randomUUID();
  const petB = randomUUID();
  const recordA = randomUUID();
  const requestA = randomUUID();
  const conversationA = randomUUID();
  const emails = [`kirai-${runId}-a@example.test`, `kirai-${runId}-b@example.test`];
  let fixturesCreated = false;
  try {
    const database = await pool.query<{ name: string }>("SELECT current_database() AS name");
    assert.equal(database.rows[0].name, "petcare_test", `Refusing test fixtures outside petcare_test (${runId}).`);
    await assertMigrationsApplied(pool, ["kirai_conversations"]);

    await pool.query(
      "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'integration-only-hash','KIRAI test A'),($3,$4,'integration-only-hash','KIRAI test B')",
      [ownerA, emails[0], ownerB, emails[1]],
    );
    fixturesCreated = true;
    await pool.query(
      "INSERT INTO pets(id,owner_id,name,species,breed) VALUES($1,$2,'Juan','cat','Siamés'),($3,$4,'Juan','dog','Labrador')",
      [petA, ownerA, petB, ownerB],
    );
    await pool.query(
      "INSERT INTO health_records(id,owner_id,pet_id,record_type,title,description,occurred_at,clinic_name,observations) VALUES($1,$2,$3,'vaccination','Vacuna de prueba','Dato de prueba KIRAI','2026-01-02T12:00:00Z','Clínica de prueba','Observación KIRAI')",
      [recordA, ownerA, petA],
    );

    const contextA = await loadRemotePetContext(pool, ownerA);
    const contextB = await loadRemotePetContext(pool, ownerB);
    assert.deepEqual(contextA.pets?.map((pet) => pet.name), ["Juan"]);
    assert.deepEqual(contextA.healthRecords?.map((record) => record.title), ["Vacuna de prueba"]);
    assert.deepEqual(contextB.pets?.map((pet) => pet.name), ["Juan"]);
    assert.deepEqual(contextB.healthRecords, []);
    assert.equal(contextA.pets?.[0].owner_id, undefined);

    const store = new PostgresKiraiStore(pool);
    const first = await store.prepareRequest({ ownerId: ownerA, conversationId: conversationA, requestId: requestA, message: "¿Qué sabes de Juan?" });
    const answer = await store.saveAnswer(ownerA, first.message, "En los registros figura una vacuna de prueba.", false);
    const replay = await store.prepareRequest({ ownerId: ownerA, conversationId: conversationA, requestId: requestA, message: "¿Qué sabes de Juan?" });
    assert.equal(replay.message.id, first.message.id);
    assert.equal(replay.answer?.id, answer.id);
    assert.equal((await store.listConversations(ownerA)).length, 1);
    assert.equal((await store.listConversations(ownerB)).length, 0);
    assert.equal((await store.listMessages(ownerA, conversationA, 0, 10)).messages.length, 2);
    await assert.rejects(store.listMessages(ownerB, conversationA, 0, 10), KiraiNotFoundError);
  } finally {
    try {
      if (fixturesCreated) {
        await pool.query("DELETE FROM kirai_messages WHERE owner_id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        await pool.query("DELETE FROM kirai_conversations WHERE owner_id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        await pool.query("DELETE FROM health_records WHERE owner_id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        await pool.query("DELETE FROM sync_changes WHERE owner_id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        await pool.query("DELETE FROM sync_cursors WHERE owner_id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        await pool.query("DELETE FROM pets WHERE owner_id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        const remaining = await pool.query("SELECT 1 FROM users WHERE id = ANY($1::uuid[])", [[ownerA, ownerB]]);
        assert.equal(remaining.rowCount, 0, `KIRAI integration cleanup failed (${runId}).`);
      }
    } finally {
      await pool.end();
    }
  }
});
