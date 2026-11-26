export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface Principal {
  userId: string;
  sessionId: string;
}

export interface AuthSession {
  id: string;
  user: AuthUser;
}

export type RefreshResult =
  | { kind: "rotated"; session: AuthSession }
  | { kind: "invalid" }
  | { kind: "reused" };

export interface AuthStore {
  createUserAndSession(input: {
    email: string;
    passwordHash: string;
    name: string;
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthUser>;
  findUserById(id: string): Promise<AuthUser | undefined>;
  findUserCredentialsById(id: string): Promise<(AuthUser & { passwordHash: string }) | undefined>;
  updateUserProfile(input: { userId: string; email: string; name: string }): Promise<AuthUser>;
  updatePassword(input: { userId: string; currentSessionId: string; passwordHash: string }): Promise<void>;
  deactivateUser(userId: string): Promise<void>;
  requestPermanentDeletion(userId: string): Promise<{ requestId: string }>;
  findUserByEmail(email: string): Promise<
    | (AuthUser & { passwordHash: string })
    | undefined
  >;
  createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  rotateRefreshToken(input: {
    presentedTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
  }): Promise<RefreshResult>;
  revokeSession(input: {
    sessionId: string;
    userId: string;
  }): Promise<void>;
  isSessionActive(input: {
    sessionId: string;
    userId: string;
  }): Promise<boolean>;
}
