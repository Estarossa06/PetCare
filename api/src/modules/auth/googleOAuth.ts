import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { Logger } from "../../observability/logger.js";
import { GoogleAccountPasswordUnavailableError, GoogleIdentityConflictError, InvalidCredentialsError } from "./errors.js";
import type { AuthService } from "./service.js";
import type { AccountRecoveryEmailSender } from "./recoveryEmail.js";
import type { AuthStore, OAuthTransaction, Principal } from "./types.js";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webReturnUrl: string;
}

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  nonce: string;
}

export interface GoogleCodeProvider {
  createAuthorizationUrl(input: { state: string; nonce: string }): Promise<{ url: string; codeVerifier: string }>;
  exchangeCode(code: string, codeVerifier: string): Promise<VerifiedGoogleIdentity>;
}

export class GoogleOAuthProvider implements GoogleCodeProvider {
  private readonly client: OAuth2Client;

  constructor(private readonly config: GoogleOAuthConfig) {
    this.client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  }

  async createAuthorizationUrl(input: { state: string; nonce: string }): Promise<{ url: string; codeVerifier: string }> {
    const verifier = await this.client.generateCodeVerifierAsync();
    const url = this.client.generateAuthUrl({
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state: input.state,
      nonce: input.nonce,
      code_challenge: verifier.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      access_type: "online",
      prompt: "select_account",
    });
    return { url, codeVerifier: verifier.codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<VerifiedGoogleIdentity> {
    const { tokens } = await this.client.getToken({ code, codeVerifier });
    if (!tokens.id_token) throw new InvalidCredentialsError();
    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId, maxExpiry: 60 * 60 });
    const payload = ticket.getPayload();
    if (
      !payload ||
      typeof payload.sub !== "string" ||
      payload.aud !== this.config.clientId ||
      (payload.azp !== undefined && payload.azp !== this.config.clientId) ||
      typeof payload.email !== "string" ||
      payload.email_verified !== true ||
      typeof payload.nonce !== "string" ||
      !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss ?? "")
    ) {
      throw new InvalidCredentialsError();
    }
    const email = payload.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InvalidCredentialsError();
    const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 100) : "";
    return { subject: payload.sub, email, emailVerified: true, name: name || email.split("@")[0] || "PetCare user", nonce: payload.nonce };
  }
}

const OAUTH_TTL_MS = 5 * 60_000;
const LINK_INTENT_TTL_MS = 60_000;
const HANDOFF_TTL_MS = 60_000;
const ACCOUNT_RECOVERY_TTL_MS = 10 * 60_000;
const PASSWORD_LINK_TTL_MS = 5 * 60_000;

export interface GoogleRecoveryOptions {
  emailSender?: AccountRecoveryEmailSender;
  codeSecret: Uint8Array;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.byteLength === b.byteLength && a.byteLength > 0 && timingSafeEqual(a, b);
}

export class GoogleOAuthFlow {
  constructor(
    private readonly store: AuthStore,
    private readonly auth: AuthService,
    private readonly config: GoogleOAuthConfig,
    private readonly logger: Logger,
    private readonly provider: GoogleCodeProvider = new GoogleOAuthProvider(config),
    private readonly recovery: GoogleRecoveryOptions = { codeSecret: new Uint8Array(0) },
  ) {}

  async startLogin(): Promise<{ url: string; state: string }> {
    return this.start("login");
  }

  async startLink(principal: Principal): Promise<string> {
    if (!(await this.store.isSessionActive(principal))) throw new InvalidCredentialsError();
    const intent = randomBytes(32).toString("base64url");
    await this.store.createOAuthLinkIntent({
      intentHash: digest(intent), userId: principal.userId, sessionId: principal.sessionId,
      expiresAt: new Date(Date.now() + LINK_INTENT_TTL_MS),
    });
    const continuation = new URL("/auth/google/link/continue", new URL(this.config.redirectUri).origin);
    continuation.searchParams.set("intent", intent);
    return continuation.toString();
  }

  async startLinkFromIntent(rawIntent: unknown): Promise<{ url: string; state: string }> {
    if (typeof rawIntent !== "string" || rawIntent.length < 32 || rawIntent.length > 128) throw new InvalidCredentialsError();
    const link = await this.store.consumeOAuthLinkIntent(digest(rawIntent));
    if (!link) throw new InvalidCredentialsError();
    const principal: Principal = { userId: link.userId, sessionId: link.sessionId, authTime: Math.floor(Date.now() / 1000) };
    return this.start("link", principal);
  }

  async callback(input: { code: unknown; state: unknown; stateCookie: unknown; providerError?: unknown; requestId: string }): Promise<string> {
    const state = typeof input.state === "string" && input.state.length <= 256 ? input.state : "";
    const stateCookie = typeof input.stateCookie === "string" && input.stateCookie.length <= 256 ? input.stateCookie : "";
    if (!state || !stateCookie || !safeEqual(digest(state), digest(stateCookie))) {
      this.logger.info({ event: "google_oauth_callback_rejected", requestId: input.requestId, code: "state_cookie_mismatch" });
      return this.returnUrl({ error: "google_sign_in_failed" });
    }
    const transaction = state ? await this.store.consumeOAuthTransaction(digest(state)) : undefined;
    try {
      if (!transaction || transaction.expiresAt.getTime() <= Date.now()) throw new InvalidCredentialsError();
      if (input.providerError || typeof input.code !== "string" || input.code.length < 1 || input.code.length > 4096) {
        throw new InvalidCredentialsError();
      }
      const identity = await this.provider.exchangeCode(input.code, transaction.codeVerifier);
      if (!safeEqual(digest(identity.nonce), transaction.nonceHash) || !identity.emailVerified) throw new InvalidCredentialsError();

      if (transaction.mode === "link") {
        if (!transaction.userId || !transaction.sessionId || !(await this.store.isSessionActive({ userId: transaction.userId, sessionId: transaction.sessionId }))) {
          throw new InvalidCredentialsError();
        }
        await this.store.linkGoogleIdentity({ userId: transaction.userId, sessionId: transaction.sessionId, email: identity.email, subject: identity.subject });
        return this.returnUrl({ linked: "1" });
      }

      const resolution = await this.auth.resolveGoogleLogin({ email: identity.email, name: identity.name, subject: identity.subject });
      if (resolution.kind === "password_link_required") {
        if (this.recovery.codeSecret.byteLength < 32) throw new InvalidCredentialsError();
        const linkCode = randomBytes(32).toString("base64url");
        const flowHash = digest(linkCode);
        const codeHash = createHmac("sha256", this.recovery.codeSecret)
          .update("petcare:google-account-link:password-proof:").update(flowHash).digest("hex");
        await this.store.createGoogleAccountRecoveryChallenge({
          flowHash,
          userId: resolution.userId,
          providerSubject: identity.subject,
          providerEmail: identity.email,
          providerName: identity.name,
          codeHash,
          expiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_MS),
        });
        return this.returnUrl({ passwordLinkCode: linkCode });
      }
      if (resolution.kind === "account_recovery_required") {
        if (!this.recovery.emailSender || this.recovery.codeSecret.byteLength < 32) {
          this.logger.info({ event: "google_account_recovery_unavailable", requestId: input.requestId });
          throw new GoogleAccountPasswordUnavailableError();
        }
        const recoveryCode = randomBytes(32).toString("base64url");
        const flowHash = digest(recoveryCode);
        const emailCode = String(randomInt(0, 100_000_000)).padStart(8, "0");
        const codeHash = createHmac("sha256", this.recovery.codeSecret)
          .update("petcare:google-account-recovery:email-code:").update(flowHash).update(":").update(emailCode).digest("hex");
        await this.store.createGoogleAccountRecoveryChallenge({
          flowHash,
          userId: resolution.userId,
          providerSubject: identity.subject,
          providerEmail: identity.email,
          providerName: identity.name,
          codeHash,
          expiresAt: new Date(Date.now() + ACCOUNT_RECOVERY_TTL_MS),
        });
        try {
          await this.recovery.emailSender.sendAccountRecoveryCode(identity.email, emailCode);
        } catch {
          await this.store.invalidateGoogleAccountRecoveryChallenge(flowHash);
          this.logger.info({ event: "google_account_recovery_email_failed", requestId: input.requestId });
          throw new InvalidCredentialsError();
        }
        return this.returnUrl({ recoveryCode });
      }
      const code = randomBytes(32).toString("base64url");
      await this.store.createOAuthHandoff({ codeHash: digest(code), userId: resolution.user.id, expiresAt: new Date(Date.now() + HANDOFF_TTL_MS) });
      return this.returnUrl({ code });
    } catch (error) {
      const publicError = error instanceof GoogleIdentityConflictError ? "identity_conflict"
        : error instanceof GoogleAccountPasswordUnavailableError ? "account_password_unavailable" : "google_sign_in_failed";
      this.logger.info({ event: "google_oauth_callback_rejected", requestId: input.requestId, code: publicError });
      return this.returnUrl({ error: publicError });
    }
  }

  private async start(mode: "login" | "link", principal?: Principal): Promise<{ url: string; state: string }> {
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const authorization = await this.provider.createAuthorizationUrl({ state, nonce });
    const transaction: OAuthTransaction & { stateHash: string; expiresAt: Date } = {
      stateHash: digest(state), nonceHash: digest(nonce), codeVerifier: authorization.codeVerifier,
      mode, ...(principal ? { userId: principal.userId, sessionId: principal.sessionId } : {}),
      expiresAt: new Date(Date.now() + OAUTH_TTL_MS),
    };
    await this.store.createOAuthTransaction(transaction);
    return { url: authorization.url, state };
  }

  private returnUrl(parameters: Record<string, string>): string {
    const target = new URL(this.config.webReturnUrl);
    const { code, recoveryCode, passwordLinkCode, ...queryParameters } = parameters;
    for (const [key, value] of Object.entries(queryParameters)) target.searchParams.set(key, value);
    if (code) target.hash = new URLSearchParams({ code }).toString();
    else if (recoveryCode) target.hash = new URLSearchParams({ recoveryCode }).toString();
    else if (passwordLinkCode) target.hash = new URLSearchParams({ passwordLinkCode }).toString();
    return target.toString();
  }
}
