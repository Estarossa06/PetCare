import { randomUUID } from "node:crypto";
import { DuplicateEmailError } from "../src/modules/auth/errors.js";
import {
  type AuthSession,
  type AuthStore,
  type AuthUser,
  type RefreshResult,
} from "../src/modules/auth/types.js";

interface StoredUser extends AuthUser {
  passwordHash: string;
  deleted: boolean;
}

interface StoredSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revoked: boolean;
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

  async createUserAndSession(input: {
    email: string;
    passwordHash: string;
    name: string;
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
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
  ): Promise<(AuthUser & { passwordHash: string }) | undefined> {
    const user = [...this.users.values()].find((item) => item.email === email && !item.deleted);
    return user ? { ...publicUser(user), passwordHash: user.passwordHash } : undefined;
  }

  async findUserById(id: string): Promise<AuthUser | undefined> {
    const user = this.users.get(id);
    return user && !user.deleted ? publicUser(user) : undefined;
  }

  async findUserCredentialsById(id: string): Promise<(AuthUser & { passwordHash: string }) | undefined> {
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
  }): Promise<void> {
    this.sessions.set(input.id, {
      id: input.id,
      userId: input.userId,
      expiresAt: input.expiresAt,
      revoked: false,
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
