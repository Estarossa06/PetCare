import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { migrations } from "../src/db/migrations/index.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import type { Logger } from "../src/observability/logger.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const integrationEnabled =
  Boolean(databaseUrl) && process.env.PETCARE_RUN_AUTH_DB_TESTS === "1";
const testPassword = "postgres integration password";
const accessTokenSecret = Buffer.from(
  "postgres-integration-test-secret-at-least-32-bytes",
);

const silentLogger: Logger = {
  info: () => {},
  error: () => {},
};

test(
  "PostgreSQL auth integration uses real persistence and cleans up fixtures",
  {
    skip:
      !integrationEnabled &&
      "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for a disposable *_test database.",
  },
  async () => {
    const pool = createDatabasePool(databaseUrl!);
    let server: Server | undefined;
    let fixturesStarted = false;
    const userIds: string[] = [];
    const emails: string[] = [
      `auth-integration-${randomUUID()}@example.test`,
      `auth-integration-${randomUUID()}@example.test`,
    ];

    try {
      const databaseInfo = await pool.query<{ database: string }>(
        "SELECT current_database() AS database",
      );
      assert.match(
        databaseInfo.rows[0].database,
        /(^|[_-])test($|[_-])/i,
        "Refusing to write auth fixtures outside a database with a test name.",
      );

      const appliedResult = await pool.query<{
        version: number;
        name: string;
        checksum: string;
      }>("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
      const applied = new Map(appliedResult.rows.map((row) => [row.version, row]));
      for (const migration of migrations) {
        const row = applied.get(migration.version);
        assert.ok(row, `Migration ${migration.version} is required for auth tests.`);
        assert.equal(row.name, migration.name);
        assert.equal(
          row.checksum,
          createHash("sha256").update(migration.up.toString()).digest("hex"),
        );
      }

      const app = createApp({
        config: { corsOrigins: [], accessTokenSecret },
        database: pool,
        authStore: new PostgresAuthStore(pool),
        logger: silentLogger,
      });
      server = createServer(app);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      fixturesStarted = true;

      const [emailA, emailB] = emails;
      const registerA = await postJson(baseUrl, "/auth/register", {
        email: emailA,
        password: testPassword,
        name: "Integration owner A",
      });
      assert.equal(registerA.status, 201);
      const tokensA = await registerA.json();
      userIds.push(tokensA.user.id);
      assert.equal("password" in tokensA.user, false);

      const duplicate = await postJson(baseUrl, "/auth/register", {
        email: emailA,
        password: testPassword,
        name: "Duplicate",
      });
      assert.equal(duplicate.status, 409);

      const invalidLogin = await postJson(baseUrl, "/auth/login", {
        email: emailA,
        password: "incorrect password",
      });
      assert.equal(invalidLogin.status, 401);

      const login = await postJson(baseUrl, "/auth/login", {
        email: emailA.toUpperCase(),
        password: testPassword,
      });
      assert.equal(login.status, 200);
      const loginTokens = await login.json();

      const identity = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${loginTokens.accessToken}` },
      });
      assert.equal(identity.status, 200);
      assert.deepEqual((await identity.json()).user, tokensA.user);

      const refreshed = await postJson(baseUrl, "/auth/refresh", {
        refreshToken: loginTokens.refreshToken,
      });
      assert.equal(refreshed.status, 200);
      const rotatedTokens = await refreshed.json();
      assert.notEqual(rotatedTokens.refreshToken, loginTokens.refreshToken);

      const replay = await postJson(baseUrl, "/auth/refresh", {
        refreshToken: loginTokens.refreshToken,
      });
      assert.equal(replay.status, 401);
      const revokedSession = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${rotatedTokens.accessToken}` },
      });
      assert.equal(revokedSession.status, 401);

      const registerB = await postJson(baseUrl, "/auth/register", {
        email: emailB,
        password: testPassword,
        name: "Integration owner B",
      });
      assert.equal(registerB.status, 201);
      const tokensB = await registerB.json();
      userIds.push(tokensB.user.id);
      assert.notEqual(tokensB.user.id, tokensA.user.id);

      const logout = await postJson(
        baseUrl,
        "/auth/logout",
        {},
        tokensB.accessToken,
      );
      assert.equal(logout.status, 204);
      const loggedOutIdentity = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${tokensB.accessToken}` },
      });
      assert.equal(loggedOutIdentity.status, 401);

      const stored = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM users WHERE id = ANY($1::uuid[])",
        [userIds],
      );
      assert.equal(Number(stored.rows[0].count), userIds.length);
    } finally {
      if (server) {
        const closed = once(server, "close");
        server.close();
        await closed;
      }
      if (fixturesStarted) {
        await pool.query(
          `DELETE FROM auth_refresh_tokens AS token
           USING auth_sessions AS session, users
           WHERE token.session_id = session.id
             AND session.user_id = users.id
             AND users.email = ANY($1::text[])`,
          [emails],
        );
        await pool.query(
          `DELETE FROM auth_sessions AS session
           USING users
           WHERE session.user_id = users.id AND users.email = ANY($1::text[])`,
          [emails],
        );
        await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
      }
      await pool.end();
    }
  },
);

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
