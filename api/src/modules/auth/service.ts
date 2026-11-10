import { randomUUID } from "node:crypto";
import { hashPassword, validatePassword, verifyPassword } from "./passwords.js";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "./tokens.js";
import {
  InvalidCredentialsError,
  InvalidRequestError,
  type AuthStore,
  type AuthUser,
  type Principal,
} from "./types.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    const email = normalizeEmail(input.email);
    const password = validatePasswordInput(input.password);
    const name = validateName(input.name);
    const passwordHash = await hashPassword(password);
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    const expiresAt = refreshTokenExpiry();
    const user = await this.store.createUserAndSession({
      email,
      passwordHash,
      name,
      sessionId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt,
    });
    const access = await signAccessToken(user, sessionId, this.accessTokenSecret);
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
    const email = normalizeEmail(input.email);
    const password = validatePasswordInput(input.password);
    const user = await this.store.findUserByEmail(email);
    const matches = await verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !matches) {
      throw new InvalidCredentialsError();
    }
    return this.createSession(user);
  }

  async refresh(rawRefreshToken: unknown): Promise<TokenPair> {
    if (
      typeof rawRefreshToken !== "string" ||
      rawRefreshToken.length < 32 ||
      rawRefreshToken.length > 128
    ) {
      throw new InvalidCredentialsError();
    }
    const nextRefreshToken = createRefreshToken();
    const result = await this.store.rotateRefreshToken({
      presentedTokenHash: hashRefreshToken(rawRefreshToken),
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

  private async createSession(user: AuthUser): Promise<TokenPair> {
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    await this.store.createSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
    });
    const access = await signAccessToken(user, sessionId, this.accessTokenSecret);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      user,
    };
  }
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidRequestError("A valid email is required.");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new InvalidRequestError("A valid email is required.");
  }
  return email;
}

function validatePasswordInput(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidRequestError("Password must be between 12 and 128 characters.");
  }
  try {
    validatePassword(value);
  } catch {
    throw new InvalidRequestError("Password must be between 12 and 128 characters.");
  }
  return value;
}

function validateName(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidRequestError("Name must be between 1 and 100 characters.");
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 100) {
    throw new InvalidRequestError("Name must be between 1 and 100 characters.");
  }
  return name;
}
