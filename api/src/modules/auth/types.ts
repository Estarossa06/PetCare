export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface Principal {
  userId: string;
  sessionId: string;
  authTime?: number;
}

export interface OAuthTransaction {
  nonceHash: string;
  codeVerifier: string;
  mode: "login" | "link";
  userId?: string;
  sessionId?: string;
}

export interface GoogleAccountLinkChallenge {
  userId: string;
  providerSubject: string;
  providerEmail: string;
  providerName: string;
  expiresAt: Date;
}

export interface AuthSession {
  id: string;
  user: AuthUser;
  authenticatedAt: Date;
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
    authenticatedAt?: Date;
  }): Promise<AuthUser>;
  findUserById(id: string): Promise<AuthUser | undefined>;
  findUserCredentialsById(id: string): Promise<(AuthUser & { passwordHash: string | null }) | undefined>;
  updateUserProfile(input: { userId: string; email: string; name: string }): Promise<AuthUser>;
  updatePassword(input: { userId: string; currentSessionId: string; passwordHash: string }): Promise<void>;
  deactivateUser(userId: string): Promise<void>;
  requestPermanentDeletion(userId: string): Promise<{ requestId: string }>;
  findUserByEmail(email: string): Promise<
    | (AuthUser & { passwordHash: string | null })
    | undefined
  >;
  findUserByGoogleSubject(subject: string): Promise<AuthUser | undefined>;
  createGoogleUserAndIdentity(input: { email: string; name: string; subject: string }): Promise<AuthUser>;
  linkGoogleIdentity(input: { userId: string; sessionId: string; email: string; subject: string }): Promise<void>;
  createOAuthTransaction(input: OAuthTransaction & { stateHash: string; expiresAt: Date }): Promise<void>;
  consumeOAuthTransaction(stateHash: string): Promise<(OAuthTransaction & { expiresAt: Date }) | undefined>;
  createOAuthLinkIntent(input: { intentHash: string; userId: string; sessionId: string; expiresAt: Date }): Promise<void>;
  consumeOAuthLinkIntent(intentHash: string): Promise<{ userId: string; sessionId: string } | undefined>;
  createOAuthHandoff(input: { codeHash: string; userId: string; expiresAt: Date }): Promise<void>;
  consumeOAuthHandoff(codeHash: string): Promise<AuthUser | undefined>;
  createGoogleAccountLinkChallenge(input: GoogleAccountLinkChallenge & { challengeHash: string }): Promise<void>;
  findGoogleAccountLinkChallenge(challengeHash: string): Promise<GoogleAccountLinkChallenge | undefined>;
  consumeGoogleAccountLinkChallenge(input: { challengeHash: string; expectedPasswordHash: string }): Promise<AuthUser | undefined>;
  createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    authenticatedAt?: Date;
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
