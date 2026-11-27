import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
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
  const config = {
    clientId: "test-web-client.apps.googleusercontent.com",
    clientSecret: "test-only-secret-value",
    redirectUri: "https://api.example.test/auth/google/callback",
    webReturnUrl: "https://web.example.test/oauth/google-callback",
  };
  const flow = new GoogleOAuthFlow(store, auth, config, logger, provider);
  return { store, auth, entries, provider, flow };
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

async function createRecoveryChallenge(h: ReturnType<typeof createHarness>, userId: string, email: string, subject: string) {
  const flowCode = randomUUID() + randomUUID();
  const flowHash = createHash("sha256").update(flowCode, "utf8").digest("hex");
  const emailCode = "24791368";
  const codeHash = createHmac("sha256", SECRET)
    .update("petcare:google-account-recovery:email-code:").update(flowHash).update(":").update(emailCode).digest("hex");
  await h.store.createGoogleAccountRecoveryChallenge({
    flowHash, userId, providerSubject: subject, providerEmail: email, providerName: "Recovery fixture",
    codeHash, expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return { flowCode, flowHash, emailCode };
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

test("existing PetCare account with password links to verified Google and logs in without changing credentials or sessions", async () => {
  const h = createHarness();
  const registered = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const passwordHash = h.store.users.get(registered.user.id)?.passwordHash;
  const oldSession = [...h.store.sessions.values()].find((session) => session.userId === registered.user.id);
  assert.ok(oldSession);
  const authorization = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const callback = await h.flow.callback({ code: "link-google-code", state: authorization.state, stateCookie: authorization.state, requestId: "verified-link" });
  const handoff = new URLSearchParams(new URL(callback).hash.slice(1)).get("code");
  assert.ok(handoff);
  assert.equal(new URL(callback).hash.includes("passwordLinkCode"), false);
  const tokens = await h.auth.exchangeGoogleHandoff(handoff);
  assert.equal(tokens.user.id, registered.user.id);
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.get("google-subject-123"), registered.user.id);
  assert.equal(h.store.users.get(registered.user.id)?.passwordHash, passwordHash);
  assert.equal(await h.store.isSessionActive({ userId: registered.user.id, sessionId: oldSession.id }), true);
  assert.equal(h.store.googleRecoveryChallenges.size, 0);
});

test("passwordless existing accounts link and authenticate without Resend", async () => {
  const h = createHarness();
  const account = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  h.store.users.get(account.user.id)!.passwordHash = null;
  const authorization = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const callback = await h.flow.callback({ code: "passwordless-google", state: authorization.state, stateCookie: authorization.state, requestId: "passwordless-link" });
  const handoff = new URLSearchParams(new URL(callback).hash.slice(1)).get("code");
  assert.ok(handoff);
  assert.equal((await h.auth.exchangeGoogleHandoff(handoff)).user.id, account.user.id);
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.get("google-subject-123"), account.user.id);
  assert.equal(h.store.googleRecoveryChallenges.size, 0);
});

test("unverified Google email cannot link to an existing account", async () => {
  const h = createHarness();
  const account = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const passwordHash = h.store.users.get(account.user.id)?.passwordHash;
  const authorization = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider, { emailVerified: false });
  const callback = await h.flow.callback({ code: "unverified-google", state: authorization.state, stateCookie: authorization.state, requestId: "unverified-email" });
  assert.equal(new URL(callback).searchParams.get("error"), "google_sign_in_failed");
  assert.equal(h.store.googleIdentities.size, 0);
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.users.get(account.user.id)?.passwordHash, passwordHash);
});

test("a linked Google identity logs into its owner and cannot be reassigned to a same-email account", async () => {
  const h = createHarness();
  const target = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Target" });
  const owner = await h.auth.register({ email: "owner@example.test", password: PASSWORD, name: "Identity owner" });
  h.store.googleIdentities.set("google-subject-123", owner.user.id);
  const authorization = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const callback = await h.flow.callback({ code: "claimed-google", state: authorization.state, stateCookie: authorization.state, requestId: "identity-conflict" });
  const handoff = new URLSearchParams(new URL(callback).hash.slice(1)).get("code");
  assert.ok(handoff);
  assert.equal((await h.auth.exchangeGoogleHandoff(handoff)).user.id, owner.user.id, "an already-linked subject authenticates its existing owner");
  await assert.rejects(h.store.linkGoogleIdentityByVerifiedEmail({
    userId: target.user.id, email: target.user.email, subject: "google-subject-123", emailVerified: true,
  }), (error: unknown) => error instanceof Error && error.name === "GoogleIdentityConflictError");
  assert.equal(h.store.googleIdentities.get("google-subject-123"), owner.user.id);
  assert.notEqual(h.store.users.get(target.user.id)?.passwordHash, null);
  assert.equal(h.store.users.size, 2);
});

test("concurrent verified callbacks reuse one existing user and one Google identity", async () => {
  const h = createHarness();
  const account = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  const passwordHash = h.store.users.get(account.user.id)?.passwordHash;
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => h.auth.resolveGoogleLogin({
    email: account.user.email, emailVerified: true, name: "Google name", subject: "google-subject-123",
  })));
  assert.ok(outcomes.every((outcome) => outcome.kind === "authenticated" && outcome.user.id === account.user.id));
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.size, 1);
  assert.equal(h.store.googleIdentities.get("google-subject-123"), account.user.id);
  assert.equal(h.store.users.get(account.user.id)?.passwordHash, passwordHash);
});

test("recovery code links an existing account, preserves its user id, revokes old sessions and supports Google-only", async () => {
  const h = createHarness();
  const existing = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  h.store.users.get(existing.user.id)!.passwordHash = null;
  const previousSession = [...h.store.sessions.values()].find((session) => session.userId === existing.user.id);
  assert.ok(previousSession);
  const challenge = await createRecoveryChallenge(h, existing.user.id, existing.user.email, "google-subject-123");
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.size, 0);
  const recovered = await h.auth.completeGoogleAccountRecovery({ flowCode: challenge.flowCode, emailCode: challenge.emailCode, credentialChoice: "google_only" });
  assert.equal(recovered.user.id, existing.user.id);
  assert.equal(h.store.googleIdentities.get("google-subject-123"), existing.user.id);
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.users.get(existing.user.id)?.passwordHash, null, "the prior local password must be invalidated");
  assert.equal(previousSession.revoked, true, "all prior sessions must be revoked");
  await assert.rejects(h.auth.login({ email: existing.user.email, password: PASSWORD }), InvalidCredentialsError);
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: challenge.flowCode, emailCode: challenge.emailCode, credentialChoice: "google_only" }), InvalidCredentialsError);

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
  h.store.users.get(existing.user.id)!.passwordHash = null;
  const expiredChallenge = await createRecoveryChallenge(h, existing.user.id, existing.user.email, "google-subject-expired");
  const expiredCode = expiredChallenge.flowCode;
  const storedExpiredChallenge = h.store.googleRecoveryChallenges.get(expiredChallenge.flowHash)!;
  storedExpiredChallenge.expiresAt = new Date(Date.now() - 1);
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: expiredCode, emailCode: expiredChallenge.emailCode, credentialChoice: "google_only" }), InvalidCredentialsError);

  const blockedChallenge = await createRecoveryChallenge(h, existing.user.id, existing.user.email, "google-subject-blocked");
  const blockedCode = blockedChallenge.flowCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: blockedCode, emailCode: "00000000", credentialChoice: "google_only" }), InvalidCredentialsError);
  }
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: blockedCode, emailCode: blockedChallenge.emailCode, credentialChoice: "google_only" }), InvalidCredentialsError);
  assert.equal(h.store.googleIdentities.size, 0, "exhausted attempts must not link the identity");

  const usableChallenge = await createRecoveryChallenge(h, existing.user.id, existing.user.email, "google-subject-usable");
  const newPassword = "a newly chosen password 2026";
  const recovered = await h.auth.completeGoogleAccountRecovery({ flowCode: usableChallenge.flowCode, emailCode: usableChallenge.emailCode, credentialChoice: "google_and_password", newPassword });
  assert.equal(recovered.user.id, existing.user.id);
  assert.equal((await h.auth.login({ email: existing.user.email, password: newPassword })).user.id, existing.user.id);
  await assert.rejects(h.auth.login({ email: existing.user.email, password: PASSWORD }), InvalidCredentialsError);
});

test("recovery refuses a Google subject claimed by another account without moving it", async () => {
  const h = createHarness();
  const existing = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  h.store.users.get(existing.user.id)!.passwordHash = null;
  const challenge = await createRecoveryChallenge(h, existing.user.id, existing.user.email, "google-subject-123");
  const other = await h.auth.register({ email: "other@example.test", password: PASSWORD, name: "Other account" });
  h.store.googleIdentities.set("google-subject-123", other.user.id);
  await assert.rejects(h.auth.completeGoogleAccountRecovery({ flowCode: challenge.flowCode, emailCode: challenge.emailCode, credentialChoice: "google_only" }));
  assert.equal(h.store.googleIdentities.get("google-subject-123"), other.user.id);
  assert.equal(h.store.users.get(existing.user.id)?.passwordHash, null, "conflict must leave the existing account unchanged");
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

test("an already linked Google identity signs in directly", async () => {
  const h = createHarness();
  const account = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  h.store.googleIdentities.set("google-subject-123", account.user.id);
  const authorization = await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const direct = await h.flow.callback({ code: "next-google-code", state: authorization.state, stateCookie: authorization.state, requestId: randomUUID() });
  assert.ok(new URLSearchParams(new URL(direct).hash.slice(1)).get("code"));
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.size, 1);
});
