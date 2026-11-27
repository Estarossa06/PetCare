import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { AuthService } from "../src/modules/auth/service.js";
import { InvalidCredentialsError } from "../src/modules/auth/errors.js";
import { GoogleOAuthFlow, type GoogleCodeProvider, type VerifiedGoogleIdentity } from "../src/modules/auth/googleOAuth.js";
import { verifyAccessToken } from "../src/modules/auth/tokens.js";
import type { Logger, LogFields } from "../src/observability/logger.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

const SECRET = Buffer.from("google-oauth-test-secret-at-least-32-bytes");
const PASSWORD = "correct horse battery staple";

class TestGoogleCodeProvider implements GoogleCodeProvider {
  lastState = "";
  lastNonce = "";
  lastVerifier = "test-code-verifier";
  identity: VerifiedGoogleIdentity | undefined;

  async createAuthorizationUrl(input: { state: string; nonce: string }) {
    this.lastState = input.state;
    this.lastNonce = input.nonce;
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(input.state)}`, codeVerifier: this.lastVerifier };
  }

  async exchangeCode(_code: string, verifier: string): Promise<VerifiedGoogleIdentity> {
    assert.equal(verifier, this.lastVerifier);
    if (!this.identity) throw new Error("Test provider identity not configured.");
    return { ...this.identity };
  }
}

function createHarness() {
  const store = new MemoryAuthStore();
  const auth = new AuthService(store, SECRET);
  const entries: LogFields[] = [];
  const logger: Logger = { info: (fields) => entries.push(fields), error: (fields) => entries.push(fields) };
  const provider = new TestGoogleCodeProvider();
  const sentEmailCodes: string[] = [];
  const config = {
    clientId: "test-web-client.apps.googleusercontent.com",
    clientSecret: "test-only-secret-value",
    redirectUri: "https://api.example.test/auth/google/callback",
    webReturnUrl: "https://web.example.test/oauth/google-callback",
  };
  const flow = new GoogleOAuthFlow(store, auth, config, logger, provider, {
    codeSecret: SECRET,
    emailSender: { sendAccountRecoveryCode: async (_email, code) => { sentEmailCodes.push(code); } },
  });
  return { store, auth, entries, provider, flow, sentEmailCodes };
}

function verifiedIdentity(provider: TestGoogleCodeProvider, values: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity {
  return {
    subject: "google-subject-123",
    email: "person@example.test",
    emailVerified: true,
    name: "Pet Owner",
    nonce: provider.lastNonce,
    ...values,
  };
}

test("Google OAuth flow exchanges a one-use handoff into a PetCare session without storing a password", async () => {
  const h = createHarness();
  const authorizationUrl = await h.flow.startLogin();
  assert.match(authorizationUrl.url, /^https:\/\/accounts\.google\.com\//);
  h.provider.identity = verifiedIdentity(h.provider);

  const callback = await h.flow.callback({ code: "google-one-use-code", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: randomUUID() });
  const handoff = new URLSearchParams(new URL(callback).hash.slice(1)).get("code");
  assert.ok(handoff);
  assert.equal(h.store.users.size, 1);
  const storedUser = [...h.store.users.values()][0];
  assert.equal(storedUser.passwordHash, null);
  assert.equal(storedUser.email, "person@example.test");

  const tokens = await h.auth.exchangeGoogleHandoff(handoff);
  assert.equal(tokens.user.id, storedUser.id);
  const principal = await verifyAccessToken(tokens.accessToken, SECRET);
  assert.ok(principal.authTime);
  await assert.rejects(h.auth.exchangeGoogleHandoff(handoff), InvalidCredentialsError);

  await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const returning = await h.flow.callback({ code: "google-return-code", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: randomUUID() });
  const returningCode = new URLSearchParams(new URL(returning).hash.slice(1)).get("code");
  assert.ok(returningCode);
  const returningTokens = await h.auth.exchangeGoogleHandoff(returningCode);
  assert.equal(returningTokens.user.id, storedUser.id);
  assert.equal(h.store.users.size, 1);
});

test("Google OAuth rejects wrong nonce and replayed state without creating an account", async () => {
  const h = createHarness();
  await h.flow.startLogin();
  const csrf = await h.flow.callback({ code: "authorization-code", state: h.provider.lastState, stateCookie: "x".repeat(32), requestId: "request-csrf" });
  assert.equal(new URL(csrf).searchParams.get("error"), "google_sign_in_failed");
  assert.equal(h.store.oauthTransactions.size, 1, "a mismatched browser cookie must not consume another browser's state");
  h.provider.identity = verifiedIdentity(h.provider, { nonce: "wrong-nonce" });
  const callback = await h.flow.callback({ code: "authorization-code", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: "request-a" });
  assert.equal(new URL(callback).searchParams.get("error"), "google_sign_in_failed");
  assert.equal(h.store.users.size, 0);
  const replay = await h.flow.callback({ code: "authorization-code", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: "request-b" });
  assert.equal(new URL(replay).searchParams.get("error"), "google_sign_in_failed");
  assert.equal(h.entries.every((entry) => !JSON.stringify(entry).includes("authorization-code")), true);
});

test("email provider failures invalidate recovery and logs omit codes and provider details", async () => {
  const store = new MemoryAuthStore();
  const auth = new AuthService(store, SECRET);
  const entries: LogFields[] = [];
  const logger: Logger = { info: (fields) => entries.push(fields), error: (fields) => entries.push(fields) };
  const provider = new TestGoogleCodeProvider();
  let deliveredCode = "";
  const flow = new GoogleOAuthFlow(store, auth, {
    clientId: "test-web-client.apps.googleusercontent.com",
    clientSecret: "test-only-secret-value",
    redirectUri: "https://api.example.test/auth/google/callback",
    webReturnUrl: "https://web.example.test/oauth/google-callback",
  }, logger, provider, {
    codeSecret: SECRET,
    emailSender: { sendAccountRecoveryCode: async (_email, code) => {
      deliveredCode = code;
      throw new Error("synthetic provider response contains secret data");
    } },
  });
  await auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const authorization = await flow.startLogin();
  provider.identity = verifiedIdentity(provider);
  const callback = await flow.callback({ code: "synthetic-authorization-code", state: authorization.state, stateCookie: authorization.state, requestId: "safe-request-id" });
  const callbackUrl = new URL(callback);
  assert.equal(callbackUrl.searchParams.get("error"), "google_sign_in_failed");
  assert.equal(callbackUrl.hash, "", "failed email delivery must not return a recovery bearer code");
  assert.match(deliveredCode, /^\d{8}$/);
  assert.equal(store.googleRecoveryChallenges.size, 1);
  assert.equal([...store.googleRecoveryChallenges.values()][0].consumed, true);
  const serializedLogs = JSON.stringify(entries);
  for (const secret of [deliveredCode, "synthetic-authorization-code", "synthetic provider response contains secret data"]) {
    assert.equal(serializedLogs.includes(secret), false, `logs must not contain ${secret}`);
  }
  assert.ok(entries.some((entry) => entry.event === "google_account_recovery_email_failed" && entry.requestId === "safe-request-id"));
});

test("recovery code links an existing account, preserves its user id, revokes old sessions and supports Google-only", async () => {
  const h = createHarness();
  const existing = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const previousSession = [...h.store.sessions.values()].find((session) => session.userId === existing.user.id);
  assert.ok(previousSession);
  await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const callback = await h.flow.callback({ code: "login-code", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: randomUUID() });
  const callbackUrl = new URL(callback);
  const recoveryCode = new URLSearchParams(callbackUrl.hash.slice(1)).get("recoveryCode");
  assert.ok(recoveryCode);
  assert.equal(callbackUrl.searchParams.has("recoveryCode"), false, "recovery bearer code must stay out of HTTP requests");
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.size, 0);
  assert.equal(h.sentEmailCodes.length, 1);
  const recovered = await h.auth.completeGoogleAccountRecovery({ flowCode: recoveryCode, emailCode: h.sentEmailCodes[0], credentialChoice: "google_only" });
  assert.equal(recovered.user.id, existing.user.id);
  assert.equal(h.store.googleIdentities.get("google-subject-123"), existing.user.id);
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.users.get(existing.user.id)?.passwordHash, null, "the prior local password must be invalidated");
  assert.equal(previousSession.revoked, true, "all prior sessions must be revoked");
  await assert.rejects(h.auth.login({ email: existing.user.email, password: PASSWORD }), InvalidCredentialsError);
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: recoveryCode, emailCode: h.sentEmailCodes[0], credentialChoice: "google_only" }), InvalidCredentialsError);

  await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const returning = await h.flow.callback({ code: "google-login-after-link", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: randomUUID() });
  const handoff = new URLSearchParams(new URL(returning).hash.slice(1)).get("code");
  assert.ok(handoff);
  assert.equal((await h.auth.exchangeGoogleHandoff(handoff)).user.id, existing.user.id);
  assert.equal(h.store.users.size, 1);
});

test("recovery rejects bad codes, expires, enforces five attempts and permits a new traditional password", async () => {
  const h = createHarness();
  const existing = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const startRecovery = async () => {
    const authorization = await h.flow.startLogin();
    h.provider.identity = verifiedIdentity(h.provider);
    const callback = await h.flow.callback({ code: "recovery-code", state: authorization.state, stateCookie: authorization.state, requestId: randomUUID() });
    const code = new URLSearchParams(new URL(callback).hash.slice(1)).get("recoveryCode");
    assert.ok(code);
    return code;
  };
  const expiredCode = await startRecovery();
  const expiredChallenge = [...h.store.googleRecoveryChallenges.values()][0];
  expiredChallenge.expiresAt = new Date(Date.now() - 1);
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: expiredCode, emailCode: h.sentEmailCodes.at(-1), credentialChoice: "google_only" }), InvalidCredentialsError);

  const blockedCode = await startRecovery();
  const blockedEmailCode = h.sentEmailCodes.at(-1)!;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: blockedCode, emailCode: "00000000", credentialChoice: "google_only" }), InvalidCredentialsError);
  }
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: blockedCode, emailCode: blockedEmailCode, credentialChoice: "google_only" }), InvalidCredentialsError);
  assert.equal(h.store.googleIdentities.size, 0, "exhausted attempts must not link the identity");

  const usableCode = await startRecovery();
  const newPassword = "a newly chosen password 2026";
  const recovered = await h.auth.completeGoogleAccountRecovery({ flowCode: usableCode, emailCode: h.sentEmailCodes.at(-1), credentialChoice: "google_and_password", newPassword });
  assert.equal(recovered.user.id, existing.user.id);
  assert.equal((await h.auth.login({ email: existing.user.email, password: newPassword })).user.id, existing.user.id);
  await assert.rejects(h.auth.login({ email: existing.user.email, password: PASSWORD }), InvalidCredentialsError);
});

test("recovery refuses a Google subject claimed by another account without moving it", async () => {
  const h = createHarness();
  const existing = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const recoveryAuthorization = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const recoveryCallback = await h.flow.callback({ code: "recovery-code", state: recoveryAuthorization.state, stateCookie: recoveryAuthorization.state, requestId: randomUUID() });
  const recoveryCode = new URLSearchParams(new URL(recoveryCallback).hash.slice(1)).get("recoveryCode");
  assert.ok(recoveryCode);
  const other = await h.auth.register({ email: "other@example.test", password: PASSWORD, name: "Other account" });
  h.store.googleIdentities.set("google-subject-123", other.user.id);
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: recoveryCode, emailCode: h.sentEmailCodes.at(-1), credentialChoice: "google_only" }));
  assert.equal(h.store.googleIdentities.get("google-subject-123"), other.user.id);
  assert.equal(h.store.users.get(existing.user.id)?.passwordHash !== null, true);
});

test("profile-initiated Google linking needs only the active session", async () => {
  const h = createHarness();
  const existing = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const principal = await verifyAccessToken(existing.accessToken, SECRET);
  const continuation = await h.flow.startLink(principal);
  const intent = new URL(continuation).searchParams.get("intent");
  assert.ok(intent);
  const authorization = await h.flow.startLinkFromIntent(intent);
  h.provider.identity = verifiedIdentity(h.provider, { subject: "another-google-subject", email: "other@example.test" });
  const linked = await h.flow.callback({ code: "link-code", state: authorization.state, stateCookie: authorization.state, requestId: randomUUID() });
  assert.equal(new URL(linked).searchParams.get("linked"), "1");
  await assert.rejects(h.flow.startLinkFromIntent(intent), InvalidCredentialsError);
  assert.equal(h.store.googleIdentities.get("another-google-subject"), existing.user.id);
  assert.equal(h.store.users.size, 1);
});

/*
 * A normal Google callback remains a direct login after the email recovery flow has linked its subject.
 */
test("Google identity linked by recovery signs in directly on the next OAuth attempt", async () => {
  const h = createHarness();
  await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const authorization = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const callback = await h.flow.callback({ code: "recovery-code", state: authorization.state, stateCookie: authorization.state, requestId: randomUUID() });
  const recoveryCode = new URLSearchParams(new URL(callback).hash.slice(1)).get("recoveryCode");
  assert.ok(recoveryCode);
  await h.auth.completeGoogleAccountRecovery({ flowCode: recoveryCode, emailCode: h.sentEmailCodes.at(-1), credentialChoice: "google_only" });
  const next = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const direct = await h.flow.callback({ code: "next-google-code", state: next.state, stateCookie: next.state, requestId: randomUUID() });
  assert.ok(new URLSearchParams(new URL(direct).hash.slice(1)).get("code"));
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.size, 1);
});
