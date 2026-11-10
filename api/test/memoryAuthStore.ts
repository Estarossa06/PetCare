import { randomUUID } from "node:crypto";
import {
  DuplicateEmailError,
  type AuthSession,
  type AuthStore,
  type AuthUser,
  type RefreshResult,
} from "../src/modules/auth/types.js";

interface StoredUser extends AuthUser {
  passwordHash: string;
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
    const user = [...this.users.values()].find((item) => item.email === email);
    return user ? { ...publicUser(user), passwordHash: user.passwordHash } : undefined;
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
    if (!user) {
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
        session.expiresAt > new Date(),
    );
  }
}

function publicUser(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, name: user.name };
}
