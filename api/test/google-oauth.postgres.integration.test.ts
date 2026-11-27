import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabasePool } from "../src/db/pool.js";
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
