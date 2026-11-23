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
    const { email, password } = validateLoginInput(input);
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
