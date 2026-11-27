import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabasePool } from "../src/db/pool.js";
import { hashPassword } from "../src/modules/auth/passwords.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import { GoogleIdentityConflictError } from "../src/modules/auth/errors.js";
import { assertMigrationsApplied } from "./assertMigrations.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.PETCARE_RUN_AUTH_DB_TESTS === "1";

test("Google identities and OAuth one-use records persist safely in petcare_test", {
  skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for disposable petcare_test only.",
}, async (context) => {
  const parsed = new URL(databaseUrl!);
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol));
  assert.equal(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "petcare_test", "Refusing any database except petcare_test.");
  const pool = createDatabasePool(databaseUrl!);
  const run = randomUUID();
  const stateHash = `state-${run}`;
  const codeHash = `handoff-${run}`;
  const intentHash = `intent-${run}`;
  const sessionId = randomUUID();
  let userId: string | undefined;
  let schemaReady = false;
  try {
    const db = await pool.query<{ database: string }>("SELECT current_database() AS database");
    assert.equal(db.rows[0].database, "petcare_test", "Refusing fixtures outside petcare_test.");
    const ledger = await pool.query<{ exists: boolean }>("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists");
    if (!ledger.rows[0].exists) {
      context.skip("Apply migration 0014 to the disposable petcare_test database before Google persistence integration assertions.");
      return;
    }
    const migration = await pool.query("SELECT 1 FROM public.schema_migrations WHERE version = 14 AND name = 'google_oauth_identities'");
    if (migration.rowCount !== 1) {
      context.skip("Migration 0014 is not applied to petcare_test; no schema changes are made by this test.");
      return;
    }
    await assertMigrationsApplied(pool, ["google_oauth_identities"]);
    schemaReady = true;
    const store = new PostgresAuthStore(pool);
    const user = await store.createGoogleUserAndIdentity({
      email: `google-${run}@example.test`, name: "OAuth integration", subject: `google-sub-${run}`,
    });
    userId = user.id;
    assert.equal((await store.findUserByGoogleSubject(`google-sub-${run}`))?.id, user.id);
    await assert.rejects(
      store.createGoogleUserAndIdentity({ email: `other-${run}@example.test`, name: "Duplicate subject", subject: `google-sub-${run}` }),
      GoogleIdentityConflictError,
    );

    await store.createOAuthTransaction({
      stateHash, nonceHash: `nonce-${run}`, codeVerifier: `verifier-${run}`, mode: "login", expiresAt: new Date(Date.now() + 60_000),
    });
    const transaction = await store.consumeOAuthTransaction(stateHash);
    assert.equal(transaction?.mode, "login");
    assert.equal(await store.consumeOAuthTransaction(stateHash), undefined, "OAuth state can only be consumed once.");

    await store.createOAuthHandoff({ codeHash, userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    assert.equal((await store.consumeOAuthHandoff(codeHash))?.id, user.id);
    assert.equal(await store.consumeOAuthHandoff(codeHash), undefined, "Handoff can only be consumed once.");

    await store.createSession({
      id: sessionId, userId: user.id, refreshTokenHash: `refresh-${run}`,
      expiresAt: new Date(Date.now() + 60_000), authenticatedAt: new Date(),
    });
    await store.createOAuthLinkIntent({ intentHash, userId: user.id, sessionId, expiresAt: new Date(Date.now() + 60_000) });
    assert.deepEqual(await store.consumeOAuthLinkIntent(intentHash), { userId: user.id, sessionId });
    assert.equal(await store.consumeOAuthLinkIntent(intentHash), undefined, "link continuation can only be consumed once");
  } finally {
    try {
      if (schemaReady) {
        await pool.query("DELETE FROM auth_oauth_transactions WHERE state_hash = $1", [stateHash]);
        await pool.query("DELETE FROM auth_oauth_handoffs WHERE code_hash = $1", [codeHash]);
        await pool.query("DELETE FROM auth_oauth_link_intents WHERE intent_hash = $1", [intentHash]);
        await pool.query("DELETE FROM auth_refresh_tokens WHERE session_id = $1", [sessionId]);
        await pool.query("DELETE FROM auth_sessions WHERE id = $1", [sessionId]);
        if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      }
    } finally { await pool.end(); }
  }
});

test("Google account-link challenges require an unchanged password and are consumed once in petcare_test", {
  skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for disposable petcare_test only.",
}, async (context) => {
  const parsed = new URL(databaseUrl!);
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol));
  assert.equal(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "petcare_test", "Refusing any database except petcare_test.");
  const pool = createDatabasePool(databaseUrl!);
  const run = randomUUID();
  const challengeHash = `link-challenge-${run}`;
  const subject = `google-link-sub-${run}`;
  let userId: string | undefined;
  let schemaReady = false;
  try {
    const db = await pool.query<{ database: string }>("SELECT current_database() AS database");
    assert.equal(db.rows[0].database, "petcare_test", "Refusing fixtures outside petcare_test.");
    const migration = await pool.query("SELECT 1 FROM public.schema_migrations WHERE version = 15 AND name = 'google_account_link_challenges'");
    if (migration.rowCount !== 1) {
      context.skip("Migration 0015 is not applied to petcare_test; no schema changes are made by this test.");
      return;
    }
    await assertMigrationsApplied(pool, ["google_oauth_identities", "google_account_link_challenges"]);
    schemaReady = true;
    const store = new PostgresAuthStore(pool);
    const passwordHash = await hashPassword("link-test-password-123");
    const user = await store.createUserAndSession({
      email: `link-${run}@example.test`, name: "OAuth link integration", passwordHash,
      sessionId: randomUUID(), refreshTokenHash: `refresh-link-${run}`, expiresAt: new Date(Date.now() + 60_000),
    });
    userId = user.id;
    await store.createGoogleAccountLinkChallenge({
      challengeHash, userId: user.id, providerSubject: subject, providerEmail: user.email,
      providerName: "OAuth link integration", expiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal((await store.findGoogleAccountLinkChallenge(challengeHash))?.userId, user.id);
    assert.equal(await store.consumeGoogleAccountLinkChallenge({ challengeHash, expectedPasswordHash: "changed-password-hash" }), undefined);
    assert.equal((await store.findGoogleAccountLinkChallenge(challengeHash))?.userId, user.id, "wrong password proof must not consume the challenge");
    const credentials = await store.findUserCredentialsById(user.id);
    assert.ok(credentials?.passwordHash);
    assert.equal((await store.consumeGoogleAccountLinkChallenge({ challengeHash, expectedPasswordHash: credentials.passwordHash }))?.id, user.id);
    assert.equal(await store.consumeGoogleAccountLinkChallenge({ challengeHash, expectedPasswordHash: credentials.passwordHash }), undefined);
    assert.equal((await store.findUserByGoogleSubject(subject))?.id, user.id);
  } finally {
    try {
      if (schemaReady && userId) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
          await client.query("DELETE FROM users WHERE id = $1", [userId]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    } finally { await pool.end(); }
  }
});
