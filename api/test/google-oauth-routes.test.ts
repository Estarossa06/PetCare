import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import type { Logger, LogFields } from "../src/observability/logger.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

const SECRET = Buffer.from("google-oauth-routes-test-secret-at-least-32-bytes");

async function launch(store: MemoryAuthStore) {
  const entries: LogFields[] = [];
  const logger: Logger = { info: (fields) => entries.push(fields), error: (fields) => entries.push(fields) };
  const app = createApp({
    config: { corsOrigins: [], accessTokenSecret: SECRET },
    database: { query: async () => ({ rows: [] }) },
    authStore: store,
    logger,
  });
  const server: Server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    entries,
    async close() {
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
}

async function addChallenge(store: MemoryAuthStore, userId: string, email: string, subject: string) {
  const rawFlowCode = randomUUID() + randomUUID();
  const flowHash = createHash("sha256").update(rawFlowCode, "utf8").digest("hex");
  const emailCode = "24791368";
  const codeHash = createHmac("sha256", SECRET)
    .update("petcare:google-account-recovery:email-code:")
    .update(flowHash)
    .update(":")
    .update(emailCode)
    .digest("hex");
  await store.createGoogleAccountRecoveryChallenge({
    flowHash,
    userId,
    providerSubject: subject,
    providerEmail: email,
    providerName: "Route test user",
    codeHash,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { rawFlowCode, emailCode };
}

test("recovery API route returns a session, rejects invalid/reused codes, and keeps credentials out of logs", async () => {
  const store = new MemoryAuthStore();
  const sessionId = randomUUID();
  const account = await store.createUserAndSession({
    email: "route-user@example.test",
    passwordHash: "synthetic-old-password-hash",
    name: "Route test user",
    sessionId,
    refreshTokenHash: "synthetic-old-refresh-hash",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const subject = "route-google-subject";
  const challenge = await addChallenge(store, account.id, account.email, subject);
  const app = await launch(store);
  try {
    const invalid = await fetch(`${app.baseUrl}/auth/google/recovery/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryCode: challenge.rawFlowCode, emailCode: "00000000", credentialChoice: "google_only" }),
    });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json() as { error: { code: string } }).error.code, "INVALID_GOOGLE_ACCOUNT_RECOVERY");

    const completed = await fetch(`${app.baseUrl}/auth/google/recovery/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryCode: challenge.rawFlowCode, emailCode: challenge.emailCode, credentialChoice: "google_only" }),
    });
    assert.equal(completed.status, 200);
    const tokens = await completed.json() as { accessToken: string; refreshToken: string; user: { id: string } };
    assert.equal(tokens.user.id, account.id);
    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken);
    assert.equal(store.googleIdentities.get(subject), account.id);
    assert.equal(await store.isSessionActive({ userId: account.id, sessionId }), false);

    const replay = await fetch(`${app.baseUrl}/auth/google/recovery/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryCode: challenge.rawFlowCode, emailCode: challenge.emailCode, credentialChoice: "google_only" }),
    });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json() as { error: { code: string } }).error.code, "INVALID_GOOGLE_ACCOUNT_RECOVERY");

    const logs = JSON.stringify(app.entries);
    for (const secret of [challenge.rawFlowCode, challenge.emailCode, "synthetic-old-refresh-hash", tokens.accessToken, tokens.refreshToken]) {
      assert.equal(logs.includes(secret), false, "request and application logs must not expose recovery/session credentials");
    }
  } finally {
    await app.close();
  }
});

test("recovery API route surfaces an identity conflict as a specific 409 without changing either account", async () => {
  const store = new MemoryAuthStore();
  const first = await store.createUserAndSession({
    email: "first@example.test", passwordHash: "first-password-hash", name: "First",
    sessionId: randomUUID(), refreshTokenHash: "first-refresh-hash", expiresAt: new Date(Date.now() + 60_000),
  });
  const second = await store.createUserAndSession({
    email: "second@example.test", passwordHash: "second-password-hash", name: "Second",
    sessionId: randomUUID(), refreshTokenHash: "second-refresh-hash", expiresAt: new Date(Date.now() + 60_000),
  });
  const subject = "already-owned-google-subject";
  store.googleIdentities.set(subject, second.id);
  const challenge = await addChallenge(store, first.id, first.email, subject);
  const app = await launch(store);
  try {
    const response = await fetch(`${app.baseUrl}/auth/google/recovery/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryCode: challenge.rawFlowCode, emailCode: challenge.emailCode, credentialChoice: "google_only" }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "GOOGLE_IDENTITY_CONFLICT");
    assert.equal(store.googleIdentities.get(subject), second.id);
    assert.equal(store.users.get(first.id)?.passwordHash, "first-password-hash");
    assert.equal(store.users.get(second.id)?.passwordHash, "second-password-hash");
  } finally {
    await app.close();
  }
});

test("auth rate limits work with Render's forwarded client IP header", async () => {
  const app = await launch(new MemoryAuthStore());
  try {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await fetch(`${app.baseUrl}/auth/google`, { headers: { "X-Forwarded-For": "198.51.100.42" } });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(503));
    assert.equal(statuses[10], 429);
    assert.equal(app.entries.some((entry) => entry.event === "request_failed"), false);
  } finally {
    await app.close();
  }
});
