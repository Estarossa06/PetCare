import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
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
    const migration = await pool.query("SELECT 1 FROM public.schema_migrations WHERE version = 16 AND name = 'google_account_recovery'");
    if (migration.rowCount !== 1) {
      context.skip("Migration 0016 is not applied to petcare_test; no schema changes are made by this test.");
      return;
    }
    await assertMigrationsApplied(pool, ["google_oauth_identities", "google_account_link_challenges", "google_account_recovery"]);
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

test("Google account recovery atomically links identity, invalidates credentials and revokes prior sessions in petcare_test", {
  skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for disposable petcare_test only.",
}, async (context) => {
  const parsed = new URL(databaseUrl!);
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol));
  assert.equal(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "petcare_test", "Refusing any database except petcare_test.");
  const pool = createDatabasePool(databaseUrl!);
  const run = randomUUID();
  const flowHash = `recovery-flow-${run}`;
  const subject = `google-recovery-sub-${run}`;
  const sessionId = randomUUID();
  const nextSessionId = randomUUID();
  const petId = randomUUID();
  let userId: string | undefined;
  let schemaReady = false;
  try {
    const db = await pool.query<{ database: string }>("SELECT current_database() AS database");
    assert.equal(db.rows[0].database, "petcare_test", "Refusing fixtures outside petcare_test.");
    const migration = await pool.query("SELECT 1 FROM public.schema_migrations WHERE version = 16 AND name = 'google_account_recovery'");
    if (migration.rowCount !== 1) {
      context.skip("Migration 0016 is not applied to petcare_test; no schema changes are made by this test.");
      return;
    }
    await assertMigrationsApplied(pool, ["google_oauth_identities", "google_account_link_challenges", "google_account_recovery"]);
    schemaReady = true;
    const store = new PostgresAuthStore(pool);
    const oldPasswordHash = await hashPassword("old-recovery-password-123");
    const user = await store.createUserAndSession({
      email: `recovery-${run}@example.test`, name: "OAuth recovery integration", passwordHash: oldPasswordHash,
      sessionId, refreshTokenHash: `refresh-old-${run}`, expiresAt: new Date(Date.now() + 60_000),
    });
    userId = user.id;
    await pool.query(
      "INSERT INTO pets (id, owner_id, name, species) VALUES ($1, $2, 'Recovery preservation fixture', 'dog')",
      [petId, user.id],
    );
    const emailCode = "38472910";
    const secret = Buffer.from("synthetic-recovery-test-secret-at-least-32-bytes");
    const codeHash = createHmac("sha256", secret).update("petcare:google-account-recovery:email-code:").update(flowHash).update(":").update(emailCode).digest("hex");
    await store.createGoogleAccountRecoveryChallenge({
      flowHash, userId: user.id, providerSubject: subject, providerEmail: user.email, providerName: "OAuth recovery integration",
      codeHash, expiresAt: new Date(Date.now() + 60_000),
    });
    await assert.rejects(store.recoverGoogleAccount({
      flowHash, codeHash, newPasswordHash: null, sessionId, refreshTokenHash: `refresh-rollback-${run}`,
      sessionExpiresAt: new Date(Date.now() + 60_000), authenticatedAt: new Date(),
    }), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23505");
    assert.equal(await store.findUserByGoogleSubject(subject), undefined, "identity insertion must roll back");
    assert.equal((await store.findUserCredentialsById(user.id))?.passwordHash, oldPasswordHash, "password changes must roll back");
    assert.equal(await store.isSessionActive({ userId: user.id, sessionId }), true, "session revocation must roll back");

    const recovered = await store.recoverGoogleAccount({
      flowHash, codeHash, newPasswordHash: null, sessionId: nextSessionId, refreshTokenHash: `refresh-new-${run}`,
      sessionExpiresAt: new Date(Date.now() + 60_000), authenticatedAt: new Date(),
    });
    assert.deepEqual(recovered, { kind: "completed", userId: user.id });
    assert.equal((await store.findUserByGoogleSubject(subject))?.id, user.id);
    const preservedPet = await pool.query<{ owner_id: string; name: string }>(
      "SELECT owner_id, name FROM pets WHERE id=$1", [petId],
    );
    assert.deepEqual(preservedPet.rows[0], { owner_id: user.id, name: "Recovery preservation fixture" });
    assert.equal((await store.findUserCredentialsById(user.id))?.passwordHash, null);
    assert.equal(await store.isSessionActive({ userId: user.id, sessionId }), false, "old sessions must be revoked");
    assert.equal(await store.isSessionActive({ userId: user.id, sessionId: nextSessionId }), true, "a new recovery session must be created atomically");
    assert.deepEqual(await store.recoverGoogleAccount({
      flowHash, codeHash, newPasswordHash: null, sessionId: randomUUID(), refreshTokenHash: `refresh-replay-${run}`,
      sessionExpiresAt: new Date(Date.now() + 60_000), authenticatedAt: new Date(),
    }), { kind: "invalid" }, "the recovery challenge must be consumed once");
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
        } finally { client.release(); }
      }
    } finally { await pool.end(); }
  }
});
