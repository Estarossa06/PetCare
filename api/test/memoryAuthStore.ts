import { randomUUID } from "node:crypto";
import { DuplicateEmailError, GoogleIdentityConflictError, InvalidCredentialsError } from "../src/modules/auth/errors.js";
import {
  type AuthSession,
  type AuthStore,
  type AuthUser,
  type GoogleAccountRecoveryChallenge,
  type GoogleAccountRecoverySessionInput,
  type RefreshResult,
  type OAuthTransaction,
} from "../src/modules/auth/types.js";

interface StoredUser extends AuthUser {
  passwordHash: string | null;
  deleted: boolean;
}

interface StoredSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revoked: boolean;
  authenticatedAt: Date;
}

interface StoredRefreshToken {
  sessionId: string;
  consumed: boolean;
  revoked: boolean;
}

export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, StoredUser>();
  readonly sessions = new Map<string, StoredSession>();
  readonly tokens = new Map<string, StoredRefreshToken>();
  readonly deletionRequests = new Set<string>();
  readonly googleIdentities = new Map<string, string>();
  readonly oauthTransactions = new Map<string, OAuthTransaction & { expiresAt: Date }>();
  readonly oauthLinkIntents = new Map<string, { userId: string; sessionId: string; expiresAt: Date }>();
  readonly oauthHandoffs = new Map<string, { userId: string; expiresAt: Date }>();
  readonly googleRecoveryChallenges = new Map<string, GoogleAccountRecoveryChallenge & { attempts: number; consumed: boolean }>();

  async createUserAndSession(input: {
    email: string;
    passwordHash: string;
    name: string;
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    authenticatedAt?: Date;
  }): Promise<AuthUser> {
    if ([...this.users.values()].some((user) => user.email === input.email)) {
      throw new DuplicateEmailError();
    }
    const user: StoredUser = {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      deleted: false,
    };
    this.users.set(user.id, user);
    this.sessions.set(input.sessionId, {
      id: input.sessionId,
      userId: user.id,
      expiresAt: input.expiresAt,
      revoked: false,
      authenticatedAt: input.authenticatedAt ?? new Date(),
    });
    this.tokens.set(input.refreshTokenHash, {
      sessionId: input.sessionId,
      consumed: false,
      revoked: false,
    });
    return publicUser(user);
  }

  async findUserByEmail(
    email: string,
  ): Promise<(AuthUser & { passwordHash: string | null }) | undefined> {
    const user = [...this.users.values()].find((item) => item.email === email && !item.deleted);
    return user ? { ...publicUser(user), passwordHash: user.passwordHash } : undefined;
  }

  async findUserByGoogleSubject(subject: string): Promise<AuthUser | undefined> {
    const userId = this.googleIdentities.get(subject);
    return userId ? this.findUserById(userId) : undefined;
  }

  async createGoogleUserAndIdentity(input: { email: string; name: string; subject: string }): Promise<AuthUser> {
    if ([...this.users.values()].some((user) => user.email === input.email)) throw new DuplicateEmailError();
    if (this.googleIdentities.has(input.subject)) throw new GoogleIdentityConflictError();
    const user: StoredUser = { id: randomUUID(), email: input.email, name: input.name, passwordHash: null, deleted: false };
    this.users.set(user.id, user);
    this.googleIdentities.set(input.subject, user.id);
    return publicUser(user);
  }

  async linkGoogleIdentityByVerifiedEmail(input: { userId: string; email: string; subject: string; emailVerified: boolean }): Promise<AuthUser> {
    if (!input.emailVerified) throw new InvalidCredentialsError();
    const user = this.users.get(input.userId);
    if (!user || user.deleted || user.email !== input.email) throw new InvalidCredentialsError();
    const existingOwner = this.googleIdentities.get(input.subject);
    if (existingOwner) {
      if (existingOwner === input.userId && [...this.googleIdentities.entries()].filter(([, userId]) => userId === input.userId).length === 1) {
        return publicUser(user);
      }
      throw new GoogleIdentityConflictError();
    }
    if ([...this.googleIdentities.values()].includes(input.userId)) throw new GoogleIdentityConflictError();
    this.googleIdentities.set(input.subject, input.userId);
    return publicUser(user);
  }

  async linkGoogleIdentity(input: { userId: string; sessionId: string; email: string; subject: string }): Promise<void> {
    const user = this.users.get(input.userId);
    if (!user || user.deleted || this.googleIdentities.has(input.subject) || [...this.googleIdentities.values()].includes(input.userId) || !await this.isSessionActive({ userId: input.userId, sessionId: input.sessionId })) {
      throw new GoogleIdentityConflictError();
    }
    this.googleIdentities.set(input.subject, input.userId);
  }

  async createOAuthTransaction(input: OAuthTransaction & { stateHash: string; expiresAt: Date }): Promise<void> {
    this.oauthTransactions.set(input.stateHash, { ...input });
  }

  async consumeOAuthTransaction(stateHash: string): Promise<(OAuthTransaction & { expiresAt: Date }) | undefined> {
    const transaction = this.oauthTransactions.get(stateHash);
    this.oauthTransactions.delete(stateHash);
    return transaction && transaction.expiresAt > new Date() ? transaction : undefined;
  }

  async createOAuthLinkIntent(input: { intentHash: string; userId: string; sessionId: string; expiresAt: Date }): Promise<void> {
    this.oauthLinkIntents.set(input.intentHash, { userId: input.userId, sessionId: input.sessionId, expiresAt: input.expiresAt });
  }

  async consumeOAuthLinkIntent(intentHash: string): Promise<{ userId: string; sessionId: string } | undefined> {
    const intent = this.oauthLinkIntents.get(intentHash);
    this.oauthLinkIntents.delete(intentHash);
    if (!intent || intent.expiresAt.getTime() <= Date.now() || !(await this.isSessionActive(intent))) return undefined;
    return { userId: intent.userId, sessionId: intent.sessionId };
  }

  async createOAuthHandoff(input: { codeHash: string; userId: string; expiresAt: Date }): Promise<void> {
    this.oauthHandoffs.set(input.codeHash, { userId: input.userId, expiresAt: input.expiresAt });
  }

  async consumeOAuthHandoff(codeHash: string): Promise<AuthUser | undefined> {
    const handoff = this.oauthHandoffs.get(codeHash);
    this.oauthHandoffs.delete(codeHash);
    return handoff && handoff.expiresAt > new Date() ? this.findUserById(handoff.userId) : undefined;
  }

  async createGoogleAccountRecoveryChallenge(input: GoogleAccountRecoveryChallenge & { flowHash: string }): Promise<void> {
    const user = this.users.get(input.userId);
    if (!user || user.deleted || user.email !== input.providerEmail) throw new Error("Recovery account changed.");
    if ([...this.googleRecoveryChallenges.values()].some((challenge) => challenge.userId === input.userId && !challenge.consumed && challenge.expiresAt > new Date())) {
      throw new Error("A recovery email has already been sent for this account.");
    }
    this.googleRecoveryChallenges.set(input.flowHash, { ...input, attempts: 0, consumed: false });
  }

  async invalidateGoogleAccountRecoveryChallenge(flowHash: string): Promise<void> {
    const challenge = this.googleRecoveryChallenges.get(flowHash);
    if (challenge) challenge.consumed = true;
  }

  async recoverGoogleAccount(input: GoogleAccountRecoverySessionInput): Promise<
    { kind: "completed"; userId: string } | { kind: "invalid" | "incorrect_code" }
  > {
    const challenge = this.googleRecoveryChallenges.get(input.flowHash);
    const user = challenge ? this.users.get(challenge.userId) : undefined;
    if (!challenge || challenge.consumed || challenge.expiresAt <= new Date() || challenge.attempts >= 5 ||
      !user || user.deleted || user.email !== challenge.providerEmail) return { kind: "invalid" };
    if (challenge.codeHash !== input.codeHash) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) challenge.consumed = true;
      return { kind: "incorrect_code" };
    }
    if (this.googleIdentities.has(challenge.providerSubject) || [...this.googleIdentities.values()].includes(user.id)) {
      throw new GoogleIdentityConflictError();
    }
    challenge.consumed = true;
    this.googleIdentities.set(challenge.providerSubject, user.id);
    user.passwordHash = input.newPasswordHash;
    this.revokeEverySession(user.id);
    this.sessions.set(input.sessionId, {
      id: input.sessionId, userId: user.id, expiresAt: input.sessionExpiresAt, revoked: false, authenticatedAt: input.authenticatedAt,
    });
    this.tokens.set(input.refreshTokenHash, { sessionId: input.sessionId, consumed: false, revoked: false });
    return { kind: "completed", userId: user.id };
  }

  async findUserById(id: string): Promise<AuthUser | undefined> {
    const user = this.users.get(id);
    return user && !user.deleted ? publicUser(user) : undefined;
  }

  async findUserCredentialsById(id: string): Promise<(AuthUser & { passwordHash: string | null }) | undefined> {
    const user = this.users.get(id);
    return user && !user.deleted ? { ...publicUser(user), passwordHash: user.passwordHash } : undefined;
  }

  async updateUserProfile(input: { userId: string; email: string; name: string }): Promise<AuthUser> {
    const user = this.users.get(input.userId);
    if (!user || user.deleted) throw new Error("User is unavailable.");
    if ([...this.users.values()].some((candidate) => candidate.id !== input.userId && !candidate.deleted && candidate.email === input.email)) {
      throw new DuplicateEmailError();
    }
    user.email = input.email;
    user.name = input.name;
    return publicUser(user);
  }

  async updatePassword(input: { userId: string; currentSessionId: string; passwordHash: string }): Promise<void> {
    const user = this.users.get(input.userId);
    if (!user || user.deleted) throw new Error("User is unavailable.");
    user.passwordHash = input.passwordHash;
    for (const session of this.sessions.values()) {
      if (session.userId === input.userId && session.id !== input.currentSessionId) {
        session.revoked = true;
        for (const token of this.tokens.values()) if (token.sessionId === session.id) token.revoked = true;
      }
    }
  }

  async deactivateUser(userId: string): Promise<void> {
    this.users.get(userId)!.deleted = true;
    this.revokeEverySession(userId);
  }

  async requestPermanentDeletion(userId: string): Promise<{ requestId: string }> {
    this.deletionRequests.add(userId);
    await this.deactivateUser(userId);
    return { requestId: `test-${userId}` };
  }

  async createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    authenticatedAt?: Date;
  }): Promise<void> {
    this.sessions.set(input.id, {
      id: input.id,
      userId: input.userId,
      expiresAt: input.expiresAt,
      revoked: false,
      authenticatedAt: input.authenticatedAt ?? new Date(),
    });
    this.tokens.set(input.refreshTokenHash, {
      sessionId: input.id,
      consumed: false,
      revoked: false,
    });
  }

  async rotateRefreshToken(input: {
    presentedTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
  }): Promise<RefreshResult> {
    const token = this.tokens.get(input.presentedTokenHash);
    if (!token) {
      return { kind: "invalid" };
    }
    const session = this.sessions.get(token.sessionId);
    if (!session) {
      return { kind: "invalid" };
    }
    if (token.consumed) {
      session.revoked = true;
      for (const related of this.tokens.values()) {
        if (related.sessionId === session.id) related.revoked = true;
      }
      return { kind: "reused" };
    }
    if (token.revoked || session.revoked || session.expiresAt <= new Date()) {
      return { kind: "invalid" };
    }
    const user = this.users.get(session.userId);
    if (!user || user.deleted) {
      return { kind: "invalid" };
    }
    token.consumed = true;
    session.expiresAt = input.nextExpiresAt;
    this.tokens.set(input.nextTokenHash, {
      sessionId: session.id,
      consumed: false,
      revoked: false,
    });
    const result: AuthSession = {
      id: session.id,
      user: publicUser(user),
      authenticatedAt: session.authenticatedAt,
    };
    return { kind: "rotated", session: result };
  }

  async revokeSession(input: { sessionId: string; userId: string }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (session?.userId === input.userId) {
      session.revoked = true;
      for (const token of this.tokens.values()) {
        if (token.sessionId === session.id) token.revoked = true;
      }
    }
  }

  async isSessionActive(input: {
    sessionId: string;
    userId: string;
  }): Promise<boolean> {
    const session = this.sessions.get(input.sessionId);
    return Boolean(
      session &&
        session.userId === input.userId &&
        !session.revoked &&
        session.expiresAt > new Date() && !this.users.get(input.userId)?.deleted,
    );
  }

  private revokeEverySession(userId: string): void {
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      session.revoked = true;
      for (const token of this.tokens.values()) if (token.sessionId === session.id) token.revoked = true;
    }
  }
}

function publicUser(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, name: user.name };
}
