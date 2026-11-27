import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app.js";
import { OwnerScopedQueries } from "../src/modules/auth/ownerScopedQueries.js";
import { hashRefreshToken } from "../src/modules/auth/tokens.js";
import type { Logger, LogFields } from "../src/observability/logger.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

const SECRET = Buffer.from("authentication-test-secret-at-least-32-bytes");
const PASSWORD = "correct horse battery staple";

function createTestLogger(): { logger: Logger; entries: LogFields[] } {
  const entries: LogFields[] = [];
  return {
    entries,
    logger: {
      info: (fields) => entries.push(fields),
      error: (fields) => entries.push(fields),
    },
  };
}

async function listen(app: express.Express): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  const closed = once(server, "close");
  server.close();
  await closed;
}

async function createHarness() {
  const store = new MemoryAuthStore();
  const { logger, entries } = createTestLogger();
  const app = createApp({
    config: { corsOrigins: [], accessTokenSecret: SECRET },
    database: { query: async () => ({ rows: [] }) },
    authStore: store,
    logger,
  });
  const running = await listen(app);
  return { ...running, store, entries };
}

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

test("registration normalizes email, hashes password, returns a session, and rejects duplicates", async () => {
  const harness = await createHarness();
  try {
    const response = await postJson(harness.baseUrl, "/auth/register", {
      email: "  Pet.Owner@Example.COM ",
      password: PASSWORD,
      name: "  Pet Owner  ",
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.user.email, "pet.owner@example.com");
    assert.equal(result.user.name, "Pet Owner");
    assert.equal(typeof result.accessToken, "string");
    assert.equal(typeof result.refreshToken, "string");
    assert.equal("password" in result.user, false);
    assert.match(
      [...harness.store.users.values()][0].passwordHash,
      /^scrypt\$32768\$8\$1\$/,
    );
    assert.notEqual(
      [...harness.store.users.values()][0].passwordHash,
      PASSWORD,
    );
    const storedLogs = JSON.stringify(harness.entries);
    assert.equal(storedLogs.includes(PASSWORD), false);
    assert.equal(storedLogs.includes(result.refreshToken), false);

    const duplicate = await postJson(harness.baseUrl, "/auth/register", {
      email: "PET.OWNER@example.com",
      password: PASSWORD,
      name: "Another Name",
    });
    assert.equal(duplicate.status, 409);
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.error.code, "EMAIL_ALREADY_REGISTERED");
    assert.match(duplicateBody.error.message, /already exists/i);
    assert.equal(duplicateBody.error.message.includes("pet.owner@example.com"), false);
    assert.equal(harness.store.users.size, 1);

    const secondAccount = await postJson(harness.baseUrl, "/auth/register", {
      email: "another.owner@example.com",
      password: PASSWORD,
      name: "Another Owner",
    });
    assert.equal(secondAccount.status, 201);
    const secondUser = (await secondAccount.json()).user;
    assert.notEqual(secondUser.id, result.user.id);
    assert.equal(harness.store.users.size, 2);
    const firstLogin = await postJson(harness.baseUrl, "/auth/login", {
      email: "pet.owner@example.com",
      password: PASSWORD,
    });
    const secondLogin = await postJson(harness.baseUrl, "/auth/login", {
      email: "another.owner@example.com",
      password: PASSWORD,
    });
    assert.equal((await firstLogin.json()).user.id, result.user.id);
    assert.equal((await secondLogin.json()).user.id, secondUser.id);
  } finally {
    await close(harness.server);
  }
});

test("registration validates email, name, and password lengths", async () => {
  const harness = await createHarness();
  try {
    for (const body of [
      { email: "bad-email", password: PASSWORD, name: "Pet Owner" },
      { email: "pet@example.com", password: "short", name: "Pet Owner" },
      { email: "pet@example.com", password: PASSWORD, name: " " },
    ]) {
      const response = await postJson(harness.baseUrl, "/auth/register", body);
      assert.equal(response.status, 400);
    }
    assert.equal(harness.store.users.size, 0);
  } finally {
    await close(harness.server);
  }
});

test("login succeeds and failures do not reveal whether the account exists", async () => {
  const harness = await createHarness();
  try {
    await postJson(harness.baseUrl, "/auth/register", {
      email: "login@example.com",
      password: PASSWORD,
      name: "Pet Owner",
    });
    const login = await postJson(harness.baseUrl, "/auth/login", {
      email: " LOGIN@example.com ",
      password: PASSWORD,
    });
    assert.equal(login.status, 200);
    const tokens = await login.json();
    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken);

    const wrongPassword = await postJson(harness.baseUrl, "/auth/login", {
      email: "login@example.com",
      password: "incorrect password value",
    });
    const unknownAccount = await postJson(harness.baseUrl, "/auth/login", {
      email: "unknown@example.com",
      password: "incorrect password value",
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownAccount.status, 401);
    const wrongPasswordBody = await wrongPassword.json();
    const unknownAccountBody = await unknownAccount.json();
    assert.deepEqual(
      wrongPasswordBody.error,
      {
        ...unknownAccountBody.error,
        requestId: wrongPasswordBody.error.requestId,
      },
    );
  } finally {
    await close(harness.server);
  }
});

test("expired and invalid access tokens are rejected", async () => {
  const harness = await createHarness();
  try {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await harness.store.createSession({
      id: sessionId,
      userId,
      refreshTokenHash: "unused-session-hash",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("petcare-api")
      .setAudience("petcare-mobile")
      .setIssuedAt(now - 1200)
      .setExpirationTime(now - 600)
      .setJti(randomUUID())
      .sign(SECRET);

    const expired = await postJson(
      harness.baseUrl,
      "/auth/logout",
      {},
      expiredToken,
    );
    assert.equal(expired.status, 401);
    const invalid = await postJson(
      harness.baseUrl,
      "/auth/logout",
      {},
      "not-a-jwt",
    );
    assert.equal(invalid.status, 401);
    const anonymous = await postJson(harness.baseUrl, "/auth/logout", {});
    assert.equal(anonymous.status, 401);
  } finally {
    await close(harness.server);
  }
});

test("refresh rotates tokens and replay revokes the whole session", async () => {
  const harness = await createHarness();
  try {
    const registered = await postJson(harness.baseUrl, "/auth/register", {
      email: "refresh@example.com",
      password: PASSWORD,
      name: "Pet Owner",
    });
    const first = await registered.json();
    const refreshed = await postJson(harness.baseUrl, "/auth/refresh", {
      refreshToken: first.refreshToken,
    });
    assert.equal(refreshed.status, 200);
    const second = await refreshed.json();
    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.notEqual(second.accessToken, first.accessToken);

    const replay = await postJson(harness.baseUrl, "/auth/refresh", {
      refreshToken: first.refreshToken,
    });
    assert.equal(replay.status, 401);
    const afterReuse = await postJson(harness.baseUrl, "/auth/refresh", {
      refreshToken: second.refreshToken,
    });
    assert.equal(afterReuse.status, 401);
    const revokedAccess = await postJson(
      harness.baseUrl,
      "/auth/logout",
      {},
      second.accessToken,
    );
    assert.equal(revokedAccess.status, 401);
    assert.equal(
      [...harness.store.sessions.values()][0].revoked,
      true,
    );
  } finally {
    await close(harness.server);
  }
});

test("expired refresh sessions cannot be renewed", async () => {
  const harness = await createHarness();
  try {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const refreshToken = "expired-refresh-token-value-123456";
    await harness.store.createSession({
      id: sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() - 60_000),
    });
    const response = await postJson(harness.baseUrl, "/auth/refresh", {
      refreshToken,
    });
    assert.equal(response.status, 401);
  } finally {
    await close(harness.server);
  }
});

test("logout revokes refresh and access tokens", async () => {
  const harness = await createHarness();
  try {
    const registered = await postJson(harness.baseUrl, "/auth/register", {
      email: "logout@example.com",
      password: PASSWORD,
      name: "Pet Owner",
    });
    const tokens = await registered.json();
    const logout = await postJson(
      harness.baseUrl,
      "/auth/logout",
      {},
      tokens.accessToken,
    );
    assert.equal(logout.status, 204);
    const repeatedLogout = await postJson(
      harness.baseUrl,
      "/auth/logout",
      {},
      tokens.accessToken,
    );
    assert.equal(repeatedLogout.status, 401);
    const refresh = await postJson(harness.baseUrl, "/auth/refresh", {
      refreshToken: tokens.refreshToken,
    });
    assert.equal(refresh.status, 401);
  } finally {
    await close(harness.server);
  }
});

test("profile updates require the current password and keep email ownership unique", async () => {
  const harness = await createHarness();
  try {
    const first = await postJson(harness.baseUrl, "/auth/register", {
      email: "profile-one@example.com", password: PASSWORD, name: "First Owner",
    });
    const firstTokens = await first.json();
    const second = await postJson(harness.baseUrl, "/auth/register", {
      email: "profile-two@example.com", password: PASSWORD, name: "Second Owner",
    });
    const secondTokens = await second.json();

    const wrongPassword = await fetch(`${harness.baseUrl}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${firstTokens.accessToken}` },
      body: JSON.stringify({ name: "Changed", email: "changed@example.com", currentPassword: "wrong password" }),
    });
    assert.equal(wrongPassword.status, 401);

    const duplicateEmail = await fetch(`${harness.baseUrl}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${firstTokens.accessToken}` },
      body: JSON.stringify({ name: "Changed", email: secondTokens.user.email, currentPassword: PASSWORD }),
    });
    assert.equal(duplicateEmail.status, 409);

    const updated = await fetch(`${harness.baseUrl}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${firstTokens.accessToken}` },
      body: JSON.stringify({ name: "Updated Owner", email: "updated@example.com", currentPassword: PASSWORD }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).user, {
      id: firstTokens.user.id, name: "Updated Owner", email: "updated@example.com",
    });
  } finally { await close(harness.server); }
});

test("password change invalidates other sessions while preserving the current session", async () => {
  const harness = await createHarness();
  try {
    const registered = await postJson(harness.baseUrl, "/auth/register", {
      email: "password-change@example.com", password: PASSWORD, name: "Password Owner",
    });
    const primary = await registered.json();
    const secondLogin = await postJson(harness.baseUrl, "/auth/login", {
      email: "password-change@example.com", password: PASSWORD,
    });
    const secondSession = await secondLogin.json();
    const changed = await postJson(harness.baseUrl, "/auth/password", {
      currentPassword: PASSWORD, newPassword: "new secure password 2026",
    }, primary.accessToken);
    assert.equal(changed.status, 204);

    const primaryStillActive = await fetch(`${harness.baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${primary.accessToken}` },
    });
    assert.equal(primaryStillActive.status, 200);
    const secondRevoked = await fetch(`${harness.baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${secondSession.accessToken}` },
    });
    assert.equal(secondRevoked.status, 401);
    assert.equal((await postJson(harness.baseUrl, "/auth/login", {
      email: "password-change@example.com", password: PASSWORD,
    })).status, 401);
    assert.equal((await postJson(harness.baseUrl, "/auth/login", {
      email: "password-change@example.com", password: "new secure password 2026",
    })).status, 200);
  } finally { await close(harness.server); }
});

test("deactivation and permanent-deletion requests require proof and revoke account access", async () => {
  const harness = await createHarness();
  try {
    const registered = await postJson(harness.baseUrl, "/auth/register", {
      email: "deactivate@example.com", password: PASSWORD, name: "Account Owner",
    });
    const tokens = await registered.json();
    const denied = await postJson(harness.baseUrl, "/auth/deactivate", { currentPassword: "wrong password" }, tokens.accessToken);
    assert.equal(denied.status, 401);
    const deactivated = await postJson(harness.baseUrl, "/auth/deactivate", { currentPassword: PASSWORD }, tokens.accessToken);
    assert.equal(deactivated.status, 204);
    assert.equal((await fetch(`${harness.baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })).status, 401);
    assert.equal((await postJson(harness.baseUrl, "/auth/login", { email: tokens.user.email, password: PASSWORD })).status, 401);

    const deletionAccount = await postJson(harness.baseUrl, "/auth/register", {
      email: "delete-request@example.com", password: PASSWORD, name: "Deletion Owner",
    });
    const deletionTokens = await deletionAccount.json();
    const requested = await postJson(harness.baseUrl, "/auth/deletion-request", { currentPassword: PASSWORD }, deletionTokens.accessToken);
    assert.equal(requested.status, 202);
    const deletionBody = await requested.json() as { status: string; requestId: string };
    assert.equal(deletionBody.status, "pending_permanent_deletion");
    assert.ok(deletionBody.requestId.length > 0);
    assert.equal(harness.store.deletionRequests.has(deletionTokens.user.id), true);
    assert.equal(await harness.store.findUserById(deletionTokens.user.id), undefined);
    assert.equal((await postJson(harness.baseUrl, "/auth/refresh", { refreshToken: deletionTokens.refreshToken })).status, 401);
  } finally { await close(harness.server); }
});

test("owner-scoped pet lookup prevents cross-owner access and ignores client owner IDs", async () => {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const petId = randomUUID();
  let boundValues: readonly unknown[] = [];
  const queries = new OwnerScopedQueries({
    async query(
      sql: string,
      values: unknown[],
    ): Promise<{ rows: { id: string; name: string }[] }> {
      assert.match(sql, /owner_id = \$1 AND id = \$2/);
      boundValues = values;
      const [ownerId, requestedPetId] = values;
      const row: { id: string; name: string } | undefined =
        ownerId === ownerA && requestedPetId === petId
          ? { id: petId, name: "Miso" }
          : undefined;
      return { rows: row ? [row] : [] };
    },
  });

  const owned = await queries.findPet(
    { userId: ownerA, sessionId: randomUUID() },
    petId,
  );
  assert.deepEqual(owned, { id: petId, name: "Miso" });
  const crossOwner = await queries.findPet(
    { userId: ownerB, sessionId: randomUUID() },
    petId,
  );
  assert.equal(crossOwner, undefined);
  assert.deepEqual(boundValues, [ownerB, petId]);
});

test("authentication routes apply an IP-based request limit", async () => {
  const harness = await createHarness();
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postJson(
        harness.baseUrl,
        "/auth/login",
        {},
      );
      assert.equal(response.status, 400);
    }
    const limited = await postJson(harness.baseUrl, "/auth/login", {});
    assert.equal(limited.status, 429);
    assert.match(await limited.text(), /RATE_LIMITED/);
  } finally {
    await close(harness.server);
  }
});
