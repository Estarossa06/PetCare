import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { assertMigrationsApplied } from "./assertMigrations.js";
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
      "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for the disposable petcare_test database.",
  },
  async () => {
    const databaseUrlParsed = new URL(databaseUrl!);
    assert.ok(
      databaseUrlParsed.protocol === "postgres:" ||
        databaseUrlParsed.protocol === "postgresql:",
      "Refusing to connect unless PETCARE_TEST_DATABASE_URL is a PostgreSQL URL.",
    );
    assert.equal(
      decodeURIComponent(databaseUrlParsed.pathname.replace(/^\//, "")),
      "petcare_test",
      "Refusing to connect unless PETCARE_TEST_DATABASE_URL names petcare_test.",
    );
    const pool = createDatabasePool(databaseUrl!);
    let server: Server | undefined;
    let fixturesStarted = false;
    const runId = randomUUID();
    const emails: string[] = [
      `auth-integration-${runId}-a@example.test`,
      `auth-integration-${runId}-b@example.test`,
    ];

    try {
      const databaseInfo = await pool.query<{ database: string }>(
        "SELECT current_database() AS database",
      );
      assert.equal(
        databaseInfo.rows[0].database,
        "petcare_test",
        `Refusing to write auth fixtures outside petcare_test (run ${runId}).`,
      );

      await assertMigrationsApplied(pool, ["auth_refresh_token_history"]);

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
      assert.notEqual(tokensB.user.id, tokensA.user.id);

    const updatedEmail = `auth-updated-${runId}@example.test`;
    emails[1] = updatedEmail;
    const profileUpdate = await fetch(`${baseUrl}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokensB.accessToken}` },
      body: JSON.stringify({
        name: "Updated Integration B", email: updatedEmail, currentPassword: testPassword,
      }),
    });
    assert.equal(profileUpdate.status, 200);
    assert.equal((await profileUpdate.json()).user.name, "Updated Integration B");

    const changedPassword = "new postgres integration password";
    const passwordChange = await postJson(baseUrl, "/auth/password", {
      currentPassword: testPassword, newPassword: changedPassword,
    }, tokensB.accessToken);
    assert.equal(passwordChange.status, 204);
    const bStillAuthenticated = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}` },
    });
    assert.equal(bStillAuthenticated.status, 200);
    assert.equal((await postJson(baseUrl, "/auth/login", {
      email: tokensB.user.email, password: testPassword,
    })).status, 401);
    const newPasswordLogin = await postJson(baseUrl, "/auth/login", {
      email: updatedEmail, password: changedPassword,
    });
    assert.equal(newPasswordLogin.status, 200);
    const newSession = await newPasswordLogin.json();

    const deletionEmail = `auth-deletion-${runId}@example.test`;
    emails.push(deletionEmail);
    const deletionRegister = await postJson(baseUrl, "/auth/register", {
      email: deletionEmail, password: testPassword, name: "Deletion Integration Owner",
    });
    assert.equal(deletionRegister.status, 201);
    const deletionTokens = await deletionRegister.json();
    const deletionRequest = await postJson(baseUrl, "/auth/deletion-request", {
      currentPassword: testPassword,
    }, deletionTokens.accessToken);
    assert.equal(deletionRequest.status, 202);
    const deletionBody = await deletionRequest.json() as { status: string; requestId: string };
    assert.equal(deletionBody.status, "pending_permanent_deletion");
    assert.match(deletionBody.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal((await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${deletionTokens.accessToken}` },
    })).status, 401);

      const logout = await postJson(
        baseUrl,
        "/auth/logout",
        {},
        newSession.accessToken,
      );
      assert.equal(logout.status, 204);
      const loggedOutIdentity = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${newSession.accessToken}` },
      });
      assert.equal(loggedOutIdentity.status, 401);

      const stored = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM users WHERE email = ANY($1::text[])",
        [emails],
      );
      assert.equal(Number(stored.rows[0].count), emails.length);
    } finally {
      try {
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
            `DELETE FROM account_deletion_requests AS request
             USING users
             WHERE request.user_id = users.id AND users.email = ANY($1::text[])`,
            [emails],
          );
          await pool.query(
            `DELETE FROM auth_sessions AS session
             USING users
             WHERE session.user_id = users.id AND users.email = ANY($1::text[])`,
            [emails],
          );
          await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
          const residual = await pool.query<{ users: string; sessions: string; refresh_tokens: string; deletion_requests: string }>(
            `SELECT
               (SELECT count(*)::text FROM users WHERE email = ANY($1::text[])) AS users,
               (SELECT count(*)::text FROM account_deletion_requests AS request
                 JOIN users ON users.id = request.user_id
                 WHERE users.email = ANY($1::text[])) AS deletion_requests,
               (SELECT count(*)::text FROM auth_sessions AS session
                 JOIN users ON users.id = session.user_id
                 WHERE users.email = ANY($1::text[])) AS sessions,
               (SELECT count(*)::text FROM auth_refresh_tokens AS token
                 JOIN auth_sessions AS session ON session.id = token.session_id
                 JOIN users ON users.id = session.user_id
                 WHERE users.email = ANY($1::text[])) AS refresh_tokens`,
            [emails],
          );
          assert.equal(Number(residual.rows[0].users), 0, `User fixture cleanup failed for run ${runId}.`);
          assert.equal(Number(residual.rows[0].deletion_requests), 0, `Deletion-request cleanup failed for run ${runId}.`);
          assert.equal(Number(residual.rows[0].sessions), 0, `Session fixture cleanup failed for run ${runId}.`);
          assert.equal(Number(residual.rows[0].refresh_tokens), 0, `Refresh-token fixture cleanup failed for run ${runId}.`);
        }
      } finally {
        await pool.end();
      }
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
