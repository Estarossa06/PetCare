import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { AuthService } from "../src/modules/auth/service.js";
import { GoogleAccountLinkRequiredError, InvalidCredentialsError } from "../src/modules/auth/errors.js";
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

test("Google OAuth flow exchanges a one-use handoff into a PetCare session without storing a password", async () => {
  const h = createHarness();
  const authorizationUrl = await h.flow.startLogin();
  assert.match(authorizationUrl.url, /^https:\/\/accounts\.google\.com\//);
  h.provider.identity = verifiedIdentity(h.provider);

  const callback = await h.flow.callback({ code: "google-one-use-code", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: randomUUID() });
  const handoff = new URL(callback).searchParams.get("code");
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

test("existing email is never silently linked; an authenticated, reauthenticated session can link explicitly", async () => {
  const h = createHarness();
  const existing = await h.auth.register({ email: "person@example.test", password: PASSWORD, name: "Existing PetCare" });
  await h.flow.startLogin();
  h.provider.identity = verifiedIdentity(h.provider);
  const conflict = await h.flow.callback({ code: "login-code", state: h.provider.lastState, stateCookie: h.provider.lastState, requestId: randomUUID() });
  assert.equal(new URL(conflict).searchParams.get("error"), "account_link_required");
  assert.equal(h.store.users.size, 1);
  assert.equal(h.store.googleIdentities.size, 0);

  const principal = await verifyAccessToken(existing.accessToken, SECRET);
  await assert.rejects(h.flow.startLink(principal, "wrong password"), InvalidCredentialsError);
  const continuation = await h.flow.startLink(principal, PASSWORD);
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
