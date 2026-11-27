import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../dist/app.js";
import { createDatabasePool } from "../dist/db/pool.js";
import { signAccessToken } from "../dist/modules/auth/tokens.js";
import { PostgresAuthStore } from "../dist/modules/auth/postgresAuthStore.js";
import { loadKiraiOllamaConfig } from "../dist/modules/kirai/config.js";
import { OllamaProvider } from "../dist/modules/kirai/providers/ollamaProvider.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
assert.ok(databaseUrl, "PETCARE_TEST_DATABASE_URL is required.");
const parsed = new URL(databaseUrl);
assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol));
assert.equal(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "petcare_test", "Refusing any database other than petcare_test.");

const pool = createDatabasePool(databaseUrl);
const runId = randomUUID();
const userA = randomUUID(), userB = randomUUID();
const sessionA = randomUUID(), sessionB = randomUUID();
const petA = randomUUID(), petB = randomUUID();
const recordA = randomUUID(), recordB = randomUUID();
const conversationA = randomUUID(), conversationB = randomUUID();
const requestA = randomUUID(), requestB = randomUUID();
const secret = Buffer.from("kirai-e2e-local-test-secret-at-least-32-bytes");
const fixtureName = `Mora ${runId.slice(0, 6)}`;
const emailA = `kirai-e2e-${runId}-a@example.test`, emailB = `kirai-e2e-${runId}-b@example.test`;
const logger = { info() {}, error(fields) { process.stderr.write(`${JSON.stringify(fields)}\n`); } };
const provider = new OllamaProvider(loadKiraiOllamaConfig());
let fixturesCreated = false;
let server;

try {
  const database = await pool.query("SELECT current_database() AS name");
  assert.equal(database.rows[0].name, "petcare_test", "Refusing a database other than petcare_test.");
  await provider.checkAvailability();
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'integration-only-hash','KIRAI E2E A'),($3,$4,'integration-only-hash','KIRAI E2E B')",
    [userA, emailA, userB, emailB],
  );
  fixturesCreated = true;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO auth_sessions(id,user_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$5),($4,$6,$7,$5)",
    [sessionA, userA, `e2e-${runId}-a`, sessionB, expiresAt, userB, `e2e-${runId}-b`],
  );
  await pool.query(
    "INSERT INTO pets(id,owner_id,name,species,breed) VALUES($1,$2,$3,'cat','Doméstico'),($4,$5,$3,'cat','Doméstico')",
    [petA, userA, fixtureName, petB, userB],
  );
  await pool.query(
    "INSERT INTO health_records(id,owner_id,pet_id,record_type,title,description,occurred_at) VALUES($1,$2,$3,'vaccination','Vacuna antirrábica','Registro sintético de prueba KIRAI','2026-01-02T12:00:00Z'),($4,$5,$6,'consultation','Control dental','Registro sintético de prueba KIRAI','2026-01-03T12:00:00Z')",
    [recordA, userA, petA, recordB, userB, petB],
  );
  const authStore = new PostgresAuthStore(pool);
  const app = createApp({ config: { corsOrigins: [], accessTokenSecret: secret }, database: pool, authStore, logger, kiraiProvider: provider });
  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tokenA = (await signAccessToken({ id: userA, email: emailA, name: "KIRAI E2E A" }, sessionA, secret)).token;
  const tokenB = (await signAccessToken({ id: userB, email: emailB, name: "KIRAI E2E B" }, sessionB, secret)).token;
  const ask = async (token, input) => fetch(`${baseUrl}/kirai/chat`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });
  const started = performance.now();
  const responseA = await ask(tokenA, { conversationId: conversationA, requestId: requestA, message: `¿Qué vacuna tiene registrada mi mascota ${fixtureName}?` });
  const firstResponseMs = Math.round(performance.now() - started);
  assert.equal(responseA.status, 200, `Unexpected response status: ${responseA.status}`);
  const resultA = await responseA.json();
  assert.match(resultA.answer, /antirr(?:a|á)b/i, "Ollama did not identify the test vaccination from PostgreSQL context.");
  const replayA = await ask(tokenA, { conversationId: conversationA, requestId: requestA, message: `¿Qué vacuna tiene registrada mi mascota ${fixtureName}?` });
  assert.equal(replayA.status, 200);
  const replayResult = await replayA.json();
  assert.equal(replayResult.assistantMessage.id, resultA.assistantMessage.id, "Idempotent retry created a second response.");
  const responseB = await ask(tokenB, { conversationId: conversationB, requestId: requestB, message: `¿Qué antecedente médico tiene mi mascota ${fixtureName}?` });
  assert.equal(responseB.status, 200, `Unexpected response status: ${responseB.status}`);
  const resultB = await responseB.json();
  assert.doesNotMatch(resultB.answer, /antirr(?:a|á)b/i, "Owner B received Owner A's medical record.");
  const foreignRead = await fetch(`${baseUrl}/kirai/conversations/${conversationA}/messages`, { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.equal(foreignRead.status, 404, "Owner B read Owner A's conversation.");
  const count = await pool.query("SELECT count(*)::int AS count FROM kirai_messages WHERE owner_id=$1 AND conversation_id=$2", [userA, conversationA]);
  assert.equal(count.rows[0].count, 2, "Conversation was not persisted as one user/assistant pair.");
  process.stdout.write(`KIRAI E2E passed; model=${loadKiraiOllamaConfig().model}; first response latency=${firstResponseMs}ms; owner isolation, persisted history, and retry idempotency verified.\n`);
  process.stdout.write(`Synthetic answer A: ${resultA.answer}\nSynthetic answer B: ${resultB.answer}\n`);
} finally {
  try {
    if (server?.listening) {
      server.close();
      await once(server, "close");
    }
    if (fixturesCreated) {
      await pool.query("DELETE FROM kirai_messages WHERE owner_id=ANY($1::uuid[])", [[userA, userB]]);
      await pool.query("DELETE FROM kirai_conversations WHERE owner_id=ANY($1::uuid[])", [[userA, userB]]);
      await pool.query("DELETE FROM health_records WHERE owner_id=ANY($1::uuid[])", [[userA, userB]]);
      await pool.query("DELETE FROM sync_changes WHERE owner_id=ANY($1::uuid[])", [[userA, userB]]);
      await pool.query("DELETE FROM sync_cursors WHERE owner_id=ANY($1::uuid[])", [[userA, userB]]);
      await pool.query("DELETE FROM pets WHERE owner_id=ANY($1::uuid[])", [[userA, userB]]);
      await pool.query("DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])", [[userA, userB]]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[userA, userB]]);
      const left = await pool.query("SELECT 1 FROM users WHERE id=ANY($1::uuid[])", [[userA, userB]]);
      assert.equal(left.rowCount, 0, `KIRAI E2E cleanup failed (${runId}).`);
    }
  } finally {
    await pool.end();
  }
}
