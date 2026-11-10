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

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email or password is incorrect.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidRequestError extends Error {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}
