import { createHmac, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "./passwords.js";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "./tokens.js";
import {
  DuplicateEmailError,
  GoogleIdentityConflictError,
  InvalidCredentialsError,
  InvalidRequestError,
} from "./errors.js";
import {
  type AuthStore,
  type AuthUser,
  type Principal,
} from "./types.js";
import {
  validateLoginInput,
  validateRefreshToken,
  validateRegisterInput,
  validateProfileUpdate,
  validatePasswordChange,
  validateCurrentPassword,
  validateRecoveryPassword,
} from "./validation.js";
const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  user: AuthUser;
}

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly accessTokenSecret: Uint8Array,
  ) {}

  async register(input: {
    email: unknown;
    password: unknown;
    name: unknown;
  }): Promise<TokenPair> {
    const { email, password, name } = validateRegisterInput(input);
    const passwordHash = await hashPassword(password);
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    const expiresAt = refreshTokenExpiry();
    const authenticatedAt = new Date();
    const user = await this.store.createUserAndSession({
      email,
      passwordHash,
      name,
      sessionId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      authenticatedAt,
    });
    const access = await signAccessToken(user, sessionId, this.accessTokenSecret, new Date(), authenticatedAt);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      user,
    };
  }

  async login(input: {
    email: unknown;
    password: unknown;
  }): Promise<TokenPair> {
    const { email, password } = validateLoginInput(input);
    const user = await this.store.findUserByEmail(email);
    const matches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !matches) {
      throw new InvalidCredentialsError();
    }
    return this.createSession(user);
  }

  async refresh(rawRefreshToken: unknown): Promise<TokenPair> {
    const refreshToken = validateRefreshToken(rawRefreshToken);
    const nextRefreshToken = createRefreshToken();
    const result = await this.store.rotateRefreshToken({
      presentedTokenHash: hashRefreshToken(refreshToken),
      nextTokenHash: hashRefreshToken(nextRefreshToken),
      nextExpiresAt: refreshTokenExpiry(),
    });
    if (result.kind !== "rotated") {
      throw new InvalidCredentialsError();
    }
    const access = await signAccessToken(
      result.session.user,
      result.session.id,
      this.accessTokenSecret,
      new Date(),
      result.session.authenticatedAt,
    );
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: nextRefreshToken,
      user: result.session.user,
    };
  }

  async logout(principal: Principal): Promise<void> {
    await this.store.revokeSession(principal);
  }

  getUser(userId: string): Promise<AuthUser | undefined> {
    return this.store.findUserById(userId);
  }

  async updateProfile(principal: Principal, input: unknown): Promise<AuthUser> {
    const update = validateProfileUpdate(input);
    await this.verifyAccountProof(principal, update.currentPassword);
    return this.store.updateUserProfile({ userId: principal.userId, email: update.email, name: update.name });
  }

  async changePassword(principal: Principal, input: unknown): Promise<void> {
    const change = validatePasswordChange(input);
    const user = await this.verifyAccountProof(principal, change.currentPassword);
    if (change.currentPassword && change.currentPassword === change.newPassword) {
      throw new InvalidRequestError("Choose a new password different from the current password.");
    }
    await this.store.updatePassword({
      userId: principal.userId,
      currentSessionId: principal.sessionId,
      passwordHash: await hashPassword(change.newPassword),
    });
  }

  async deactivateAccount(principal: Principal, input: unknown): Promise<void> {
    const currentPassword = validateCurrentPassword(input);
    await this.verifyAccountProof(principal, currentPassword);
    await this.store.deactivateUser(principal.userId);
  }

  async requestPermanentDeletion(principal: Principal, input: unknown): Promise<{ requestId: string }> {
    const currentPassword = validateCurrentPassword(input);
    await this.verifyAccountProof(principal, currentPassword);
    return this.store.requestPermanentDeletion(principal.userId);
  }

  async resolveGoogleLogin(identity: { email: string; name: string; subject: string; emailVerified: boolean }): Promise<
    | { kind: "authenticated"; user: AuthUser }
  > {
    if (identity.emailVerified !== true) throw new InvalidCredentialsError();
    const linked = await this.store.findUserByGoogleSubject(identity.subject);
    if (linked) return { kind: "authenticated", user: linked };
    const existing = await this.store.findUserByEmail(identity.email);
    if (existing) return this.linkGoogleToExistingAccount(existing.id, identity);
    try {
      return { kind: "authenticated", user: await this.store.createGoogleUserAndIdentity(identity) };
    }
    catch (error) {
      if (error instanceof DuplicateEmailError) {
        const racedUser = await this.store.findUserByEmail(identity.email);
        if (racedUser) return this.linkGoogleToExistingAccount(racedUser.id, identity);
      }
      if (error instanceof GoogleIdentityConflictError) {
        const racedIdentity = await this.store.findUserByGoogleSubject(identity.subject);
        if (racedIdentity) return { kind: "authenticated", user: racedIdentity };
      }
      throw error;
    }
  }

  private async linkGoogleToExistingAccount(
    userId: string,
    identity: { email: string; name: string; subject: string; emailVerified: boolean },
  ): Promise<{ kind: "authenticated"; user: AuthUser }> {
    try {
      const user = await this.store.linkGoogleIdentityByVerifiedEmail({
        userId,
        email: identity.email,
        subject: identity.subject,
        emailVerified: identity.emailVerified,
      });
      return { kind: "authenticated", user };
    } catch (error) {
      if (error instanceof GoogleIdentityConflictError) {
        const racedIdentity = await this.store.findUserByGoogleSubject(identity.subject);
        if (racedIdentity?.id === userId) return { kind: "authenticated", user: racedIdentity };
      }
      throw error;
    }
  }

  async completeGoogleAccountRecovery(input: {
    flowCode: unknown;
    emailCode: unknown;
    credentialChoice: unknown;
    newPassword?: unknown;
  }): Promise<TokenPair> {
    if (typeof input.flowCode !== "string" || input.flowCode.length < 32 || input.flowCode.length > 128 ||
      typeof input.emailCode !== "string" || !/^\d{8}$/.test(input.emailCode)) {
      throw new InvalidCredentialsError();
    }
    if (input.credentialChoice !== "google_only" && input.credentialChoice !== "google_and_password") {
      throw new InvalidRequestError("Choose Google only or set a new PetCare password.");
    }
    const passwordHash = input.credentialChoice === "google_and_password"
      ? await hashPassword(validateRecoveryPassword(input.newPassword))
      : null;
    if (input.credentialChoice === "google_only" && input.newPassword !== undefined && input.newPassword !== "") {
      throw new InvalidRequestError("A password is only accepted when choosing Google and a new password.");
    }
    const flowHash = hashRefreshToken(input.flowCode);
    const codeHash = createHmac("sha256", this.accessTokenSecret)
      .update("petcare:google-account-recovery:email-code:")
      .update(flowHash)
      .update(":")
      .update(input.emailCode)
      .digest("hex");
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    const authenticatedAt = new Date();
    const expiresAt = refreshTokenExpiry();
    const result = await this.store.recoverGoogleAccount({
      flowHash,
      codeHash,
      newPasswordHash: passwordHash,
      sessionId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      sessionExpiresAt: expiresAt,
      authenticatedAt,
    });
    if (result.kind !== "completed") throw new InvalidCredentialsError();
    const user = await this.store.findUserById(result.userId);
    if (!user) throw new InvalidCredentialsError();
    const access = await signAccessToken(user, sessionId, this.accessTokenSecret, new Date(), authenticatedAt);
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken, user };
  }

  async exchangeGoogleHandoff(rawCode: unknown): Promise<TokenPair> {
    if (typeof rawCode !== "string" || rawCode.length < 32 || rawCode.length > 128) throw new InvalidCredentialsError();
    const user = await this.store.consumeOAuthHandoff(hashRefreshToken(rawCode));
    if (!user) throw new InvalidCredentialsError();
    return this.createSession(user);
  }

  private async verifyAccountProof(principal: Principal, password: string | undefined) {
    const user = await this.store.findUserCredentialsById(principal.userId);
    if (!user) throw new InvalidCredentialsError();
    if (user.passwordHash) {
      if (!password || !(await verifyPassword(password, user.passwordHash))) throw new InvalidCredentialsError();
    } else if (!principal.authTime || Math.floor(Date.now() / 1000) - principal.authTime > 300 || principal.authTime > Math.floor(Date.now() / 1000) + 60) {
      throw new InvalidCredentialsError();
    }
    return user;
  }

  private async createSession(user: AuthUser): Promise<TokenPair> {
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    const authenticatedAt = new Date();
    await this.store.createSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
      authenticatedAt,
    });
    const access = await signAccessToken(user, sessionId, this.accessTokenSecret, new Date(), authenticatedAt);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      user,
    };
  }
}
