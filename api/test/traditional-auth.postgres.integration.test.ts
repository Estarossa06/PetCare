import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { hashPassword } from "../src/modules/auth/passwords.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import type { Logger } from "../src/observability/logger.js";
import { assertMigrationsApplied } from "./assertMigrations.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.PETCARE_RUN_AUTH_DB_TESTS === "1";
const accessTokenSecret = Buffer.from("traditional-auth-integration-secret-at-least-32-bytes");
const logger: Logger = { info: () => {}, error: () => {} };

test("PostgreSQL traditional login, registration and duplicate rejection preserve existing account data in petcare_test", {
  skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for disposable petcare_test only.",
}, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(url.protocol === "postgres:" || url.protocol === "postgresql:");
  assert.equal(decodeURIComponent(url.pathname.replace(/^\//, "")), "petcare_test", "Refusing non-test database URL.");
  const pool = createDatabasePool(databaseUrl!);
  const run = randomUUID();
  const existingEmail = `traditional-existing-${run}@example.test`;
  const newEmail = `traditional-new-${run}@example.test`;
  const password = "Existing-account password 123!";
  const passwordHash = await hashPassword(password);
  const userIds: string[] = [];
  const petId = randomUUID();
  let server: Server | undefined;

  try {
    const database = await pool.query<{ name: string }>("SELECT current_database() AS name");
    assert.equal(database.rows[0]?.name, "petcare_test", "Refusing fixture writes outside petcare_test.");
    await assertMigrationsApplied(pool, ["auth_refresh_token_history"]);

    const store = new PostgresAuthStore(pool);
    const existing = await store.createUserAndSession({
      email: existingEmail,
      passwordHash,
      name: "Existing integration account",
      sessionId: randomUUID(),
      refreshTokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    userIds.push(existing.id);
    await pool.query("INSERT INTO pets (id, owner_id, name, species) VALUES ($1, $2, $3, 'cat')", [
      petId, existing.id, "Login preservation fixture",
    ]);

    const app = createApp({
      config: { corsOrigins: [], accessTokenSecret },
      database: pool,
      authStore: store,
      logger,
    });
    server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const login = await postJson(baseUrl, "/auth/login", { email: existingEmail.toUpperCase(), password });
    assert.equal(login.status, 200);
    const loginResponse = await login.json();
    assert.equal(loginResponse.user.id, existing.id);
    assert.equal(typeof loginResponse.accessToken, "string");
    assert.equal(typeof loginResponse.refreshToken, "string");

    const invalid = await postJson(baseUrl, "/auth/login", { email: existingEmail, password: "Wrong password 123!" });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).error.code, "INVALID_CREDENTIALS");

    const afterLogin = await store.findUserCredentialsById(existing.id);
    assert.equal(afterLogin?.passwordHash, passwordHash, "Login must not alter the existing password hash.");
    assert.equal(afterLogin?.email, existingEmail);
    const pet = await pool.query<{ owner_id: string; name: string }>("SELECT owner_id, name FROM pets WHERE id=$1", [petId]);
    assert.deepEqual(pet.rows[0], { owner_id: existing.id, name: "Login preservation fixture" });

    const registration = await postJson(baseUrl, "/auth/register", {
      email: newEmail, password: "New-account password 123!", name: "New integration account",
    });
    assert.equal(registration.status, 201);
    const newAccount = await registration.json();
    userIds.push(newAccount.user.id);
    assert.notEqual(newAccount.user.id, existing.id);

    const duplicate = await postJson(baseUrl, "/auth/register", {
      email: existingEmail, password: "Another-account password 123!", name: "Duplicate fixture",
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "EMAIL_ALREADY_REGISTERED");
    const existingCount = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE email=$1", [existingEmail]);
    assert.equal(Number(existingCount.rows[0]?.count), 1, "Duplicate registration must not create another user.");
    assert.equal((await store.findUserCredentialsById(existing.id))?.passwordHash, passwordHash);
  } finally {
    try {
      if (server) {
        const closed = once(server, "close");
        server.close();
        await closed;
      }
      if (userIds.length) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM pets WHERE id=$1", [petId]);
          await client.query(
            `DELETE FROM auth_refresh_tokens AS token USING auth_sessions AS session
             WHERE token.session_id=session.id AND session.user_id=ANY($1::uuid[])`,
            [userIds],
          );
          await client.query("DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM sync_changes WHERE owner_id=ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM sync_cursors WHERE owner_id=ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM sync_devices WHERE user_id=ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM sync_operations WHERE user_id=ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  }
});

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
