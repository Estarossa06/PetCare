import type { Pool, PoolClient, QueryResultRow } from "pg";
import { timingSafeEqual } from "node:crypto";
import { DuplicateEmailError, GoogleIdentityConflictError, InvalidCredentialsError } from "./errors.js";
import {
  type AuthSession,
  type AuthStore,
  type AuthUser,
  type GoogleAccountRecoveryChallenge,
  type GoogleAccountRecoverySessionInput,
  type RefreshResult,
} from "./types.js";

interface DatabaseUser extends QueryResultRow {
  id: string;
  email: string;
  name: string;
  password_hash?: string | null;
}

interface RefreshTokenRow extends QueryResultRow {
  session_id: string;
  user_id: string;
  email: string;
  name: string;
  consumed_at: Date | null;
  token_revoked_at: Date | null;
  token_is_unexpired: boolean;
  session_revoked_at: Date | null;
  session_expires_at: Date;
  session_is_unexpired: boolean;
  user_deleted_at: Date | null;
  session_authenticated_at: Date;
}

async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Authentication transaction and rollback both failed.",
        );
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async createUserAndSession(input: {
    email: string;
    passwordHash: string;
    name: string;
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    authenticatedAt?: Date;
  }): Promise<AuthUser> {
    try {
      return await transaction(this.pool, async (client) => {
        const result = await client.query<DatabaseUser>(
          `INSERT INTO users (email, password_hash, name)
           VALUES ($1, $2, $3)
           RETURNING id, email, name`,
          [input.email, input.passwordHash, input.name],
        );
        await client.query(
          `INSERT INTO auth_sessions
            (id, user_id, refresh_token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.sessionId,
            result.rows[0].id,
            input.refreshTokenHash,
            input.expiresAt,
            input.authenticatedAt ?? new Date(),
          ],
        );
        await client.query(
          `INSERT INTO auth_refresh_tokens (session_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [input.sessionId, input.refreshTokenHash, input.expiresAt],
        );
        return toAuthUser(result.rows[0]);
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505" &&
        "constraint" in error &&
        error.constraint === "users_email_unique_idx"
      ) {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  async findUserByEmail(
    email: string,
  ): Promise<(AuthUser & { passwordHash: string | null }) | undefined> {
    const result = await this.pool.query<DatabaseUser>(
      `SELECT id, email, name, password_hash
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    const row = result.rows[0];
    return row
      ? { ...toAuthUser(row), passwordHash: row.password_hash ?? null }
      : undefined;
  }

  async findUserByGoogleSubject(subject: string): Promise<AuthUser | undefined> {
    const result = await this.pool.query<DatabaseUser>(
      `SELECT users.id, users.email, users.name
       FROM auth_identities identity
       JOIN users ON users.id = identity.user_id
       WHERE identity.provider = 'google' AND identity.provider_subject = $1
         AND users.deleted_at IS NULL`,
      [subject],
    );
    return result.rows[0] ? toAuthUser(result.rows[0]) : undefined;
  }

  async createGoogleUserAndIdentity(input: { email: string; name: string; subject: string }): Promise<AuthUser> {
    try {
      return await transaction(this.pool, async (client) => {
        const result = await client.query<DatabaseUser>(
          `INSERT INTO users (email, password_hash, name, email_verified_at) VALUES ($1, NULL, $2, now())
           RETURNING id, email, name`,
          [input.email, input.name],
        );
        await client.query(
          `INSERT INTO auth_identities (user_id, provider, provider_subject, provider_email, email_verified)
           VALUES ($1, 'google', $2, $3, true)`,
          [result.rows[0].id, input.subject, input.email],
        );
        return toAuthUser(result.rows[0]);
      });
    } catch (error) {
      if (isEmailUniqueViolation(error)) throw new DuplicateEmailError();
      if (isIdentityUniqueViolation(error)) throw new GoogleIdentityConflictError();
      throw error;
    }
  }

  async linkGoogleIdentity(input: { userId: string; sessionId: string; email: string; subject: string }): Promise<void> {
    try {
      const result = await this.pool.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, provider_email, email_verified)
         SELECT users.id, 'google', $3, $4, true FROM users
         WHERE users.id = $1 AND users.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM auth_sessions session WHERE session.id = $2 AND session.user_id = users.id
             AND session.revoked_at IS NULL AND session.expires_at > now())`,
        [input.userId, input.sessionId, input.subject, input.email],
      );
      if (result.rowCount !== 1) throw new GoogleIdentityConflictError();
    } catch (error) {
      if (isIdentityUniqueViolation(error)) throw new GoogleIdentityConflictError();
      throw error;
    }
  }

  async createOAuthTransaction(input: {
    stateHash: string; nonceHash: string; codeVerifier: string; mode: "login" | "link";
    userId?: string; sessionId?: string; expiresAt: Date;
  }): Promise<void> {
    await this.pool.query("DELETE FROM auth_oauth_transactions WHERE expires_at <= now()");
    await this.pool.query(
      `INSERT INTO auth_oauth_transactions
         (state_hash, nonce_hash, code_verifier, mode, user_id, session_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.stateHash, input.nonceHash, input.codeVerifier, input.mode, input.userId ?? null, input.sessionId ?? null, input.expiresAt],
    );
  }

  async consumeOAuthTransaction(stateHash: string): Promise<{
    nonceHash: string; codeVerifier: string; mode: "login" | "link"; userId?: string; sessionId?: string; expiresAt: Date;
  } | undefined> {
    const result = await this.pool.query<{
      nonce_hash: string; code_verifier: string; mode: "login" | "link"; user_id: string | null; session_id: string | null; expires_at: Date;
    }>(
      `UPDATE auth_oauth_transactions SET consumed_at = now()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING nonce_hash, code_verifier, mode, user_id, session_id, expires_at`,
      [stateHash],
    );
    const row = result.rows[0];
    return row ? {
      nonceHash: row.nonce_hash, codeVerifier: row.code_verifier, mode: row.mode,
      ...(row.user_id ? { userId: row.user_id } : {}), ...(row.session_id ? { sessionId: row.session_id } : {}),
      expiresAt: row.expires_at,
    } : undefined;
  }

  async createOAuthLinkIntent(input: { intentHash: string; userId: string; sessionId: string; expiresAt: Date }): Promise<void> {
    await this.pool.query("DELETE FROM auth_oauth_link_intents WHERE expires_at <= now()");
    await this.pool.query(
      `INSERT INTO auth_oauth_link_intents (intent_hash, user_id, session_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.intentHash, input.userId, input.sessionId, input.expiresAt],
    );
  }

  async consumeOAuthLinkIntent(intentHash: string): Promise<{ userId: string; sessionId: string } | undefined> {
    const result = await this.pool.query<{ user_id: string; session_id: string }>(
      `UPDATE auth_oauth_link_intents intent SET consumed_at = now()
       FROM auth_sessions session, users
       WHERE intent.intent_hash = $1 AND intent.consumed_at IS NULL AND intent.expires_at > now()
         AND session.id = intent.session_id AND session.user_id = intent.user_id
         AND session.revoked_at IS NULL AND session.expires_at > now()
         AND users.id = intent.user_id AND users.deleted_at IS NULL
       RETURNING intent.user_id, intent.session_id`,
      [intentHash],
    );
    const row = result.rows[0];
    return row ? { userId: row.user_id, sessionId: row.session_id } : undefined;
  }

  async createOAuthHandoff(input: { codeHash: string; userId: string; expiresAt: Date }): Promise<void> {
    await this.pool.query("DELETE FROM auth_oauth_handoffs WHERE expires_at <= now()");
    await this.pool.query(
      `INSERT INTO auth_oauth_handoffs (code_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [input.codeHash, input.userId, input.expiresAt],
    );
  }

  async consumeOAuthHandoff(codeHash: string): Promise<AuthUser | undefined> {
    const result = await this.pool.query<DatabaseUser>(
      `UPDATE auth_oauth_handoffs handoff SET consumed_at = now()
       FROM users WHERE handoff.code_hash = $1 AND handoff.user_id = users.id
         AND handoff.consumed_at IS NULL AND handoff.expires_at > now() AND users.deleted_at IS NULL
       RETURNING users.id, users.email, users.name`,
      [codeHash],
    );
    return result.rows[0] ? toAuthUser(result.rows[0]) : undefined;
  }

  async createGoogleAccountRecoveryChallenge(input: GoogleAccountRecoveryChallenge & { flowHash: string }): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `SELECT flow_hash FROM auth_oauth_account_recovery_challenges
         WHERE user_id=$1 AND consumed_at IS NULL FOR UPDATE`, [input.userId],
      );
      const user = await client.query(
        "SELECT id FROM users WHERE id=$1 AND email=$2 AND deleted_at IS NULL FOR UPDATE",
        [input.userId, input.providerEmail],
      );
      if (user.rowCount !== 1) throw new InvalidCredentialsError();
      await client.query(
        `UPDATE auth_oauth_account_recovery_challenges SET consumed_at=now()
         WHERE user_id=$1 AND consumed_at IS NULL`, [input.userId],
      );
      await client.query(
        `DELETE FROM auth_oauth_account_recovery_challenges
         WHERE user_id=$1 AND (expires_at <= now() OR consumed_at IS NOT NULL)`, [input.userId],
      );
      await client.query(
        `INSERT INTO auth_oauth_account_recovery_challenges
           (flow_hash, user_id, provider_subject, provider_email, provider_name, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.flowHash, input.userId, input.providerSubject, input.providerEmail, input.providerName, input.codeHash, input.expiresAt],
      );
    });
  }

  async invalidateGoogleAccountRecoveryChallenge(flowHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_oauth_account_recovery_challenges SET consumed_at=now()
       WHERE flow_hash=$1 AND consumed_at IS NULL`, [flowHash],
    );
  }

  async recoverGoogleAccount(input: GoogleAccountRecoverySessionInput): Promise<
    { kind: "completed"; userId: string } | { kind: "invalid" | "incorrect_code" }
  > {
    try {
      return await transaction(this.pool, async (client) => {
        const result = await client.query<{
          user_id: string; provider_subject: string; provider_email: string; provider_name: string;
          code_hash: string; attempt_count: number; expires_at: Date; consumed_at: Date | null;
        } & QueryResultRow>(
          `SELECT user_id, provider_subject, provider_email, provider_name, code_hash,
                  attempt_count, expires_at, consumed_at
           FROM auth_oauth_account_recovery_challenges WHERE flow_hash=$1 FOR UPDATE`, [input.flowHash],
        );
        const challenge = result.rows[0];
        if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date() || challenge.attempt_count >= 5) {
          return { kind: "invalid" };
        }
        const storedCodeHash = Buffer.from(challenge.code_hash, "hex");
        const suppliedCodeHash = Buffer.from(input.codeHash, "hex");
        if (storedCodeHash.byteLength !== suppliedCodeHash.byteLength || !timingSafeEqual(storedCodeHash, suppliedCodeHash)) {
          await client.query(
            `UPDATE auth_oauth_account_recovery_challenges
             SET attempt_count=attempt_count+1,
                 consumed_at=CASE WHEN attempt_count+1 >= 5 THEN now() ELSE consumed_at END
             WHERE flow_hash=$1`, [input.flowHash],
          );
          return { kind: "incorrect_code" };
        }
        const userResult = await client.query<DatabaseUser>(
          `SELECT id, email, name FROM users
           WHERE id=$1 AND email=$2 AND deleted_at IS NULL FOR UPDATE`,
          [challenge.user_id, challenge.provider_email],
        );
        const user = userResult.rows[0];
        if (!user) return { kind: "invalid" };
        const identity = await client.query(
          `SELECT 1 FROM auth_identities WHERE provider='google'
           AND (provider_subject=$1 OR user_id=$2) LIMIT 1`,
          [challenge.provider_subject, challenge.user_id],
        );
        if (identity.rowCount) throw new GoogleIdentityConflictError();

        const consumed = await client.query(
          `UPDATE auth_oauth_account_recovery_challenges SET consumed_at=now()
           WHERE flow_hash=$1 AND consumed_at IS NULL AND expires_at>now() AND attempt_count<5`,
          [input.flowHash],
        );
        if (consumed.rowCount !== 1) return { kind: "invalid" };
        await client.query(
          `INSERT INTO auth_identities (user_id, provider, provider_subject, provider_email, email_verified)
           VALUES ($1, 'google', $2, $3, true)`,
          [challenge.user_id, challenge.provider_subject, challenge.provider_email],
        );
        await client.query(
          `UPDATE users SET password_hash=$2, email_verified_at=now(), updated_at=now()
           WHERE id=$1 AND deleted_at IS NULL`,
          [challenge.user_id, input.newPasswordHash],
        );
        await revokeAllUserSessions(client, challenge.user_id);
        await client.query(
          `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [input.sessionId, challenge.user_id, input.refreshTokenHash, input.sessionExpiresAt, input.authenticatedAt],
        );
        await client.query(
          `INSERT INTO auth_refresh_tokens (session_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [input.sessionId, input.refreshTokenHash, input.sessionExpiresAt],
        );
        return { kind: "completed", userId: challenge.user_id };
      });
    } catch (error) {
      if (isIdentityUniqueViolation(error)) throw new GoogleIdentityConflictError();
      throw error;
    }
  }

  async findUserById(id: string): Promise<AuthUser | undefined> {
    const result = await this.pool.query<DatabaseUser>(
      `SELECT id, email, name
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? toAuthUser(result.rows[0]) : undefined;
  }

  async findUserCredentialsById(id: string): Promise<(AuthUser & { passwordHash: string | null }) | undefined> {
    const result = await this.pool.query<DatabaseUser>(
      `SELECT id, email, name, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    const row = result.rows[0];
    return row ? { ...toAuthUser(row), passwordHash: row.password_hash ?? null } : undefined;
  }

  async updateUserProfile(input: { userId: string; email: string; name: string }): Promise<AuthUser> {
    try {
      const result = await this.pool.query<DatabaseUser>(
        `UPDATE users SET email = $2, name = $3,
           email_verified_at = CASE WHEN email = $2 THEN email_verified_at ELSE NULL END,
           updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id, email, name`,
        [input.userId, input.email, input.name],
      );
      if (!result.rows[0]) throw new Error("User is unavailable.");
      return toAuthUser(result.rows[0]);
    } catch (error) {
      if (isEmailUniqueViolation(error)) throw new DuplicateEmailError();
      throw error;
    }
  }

  async updatePassword(input: { userId: string; currentSessionId: string; passwordHash: string }): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [input.userId, input.passwordHash],
      );
      if (result.rowCount !== 1) throw new Error("User is unavailable.");
      await client.query(
        `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
         WHERE user_id = $1 AND id <> $2`,
        [input.userId, input.currentSessionId],
      );
      await client.query(
        `UPDATE auth_refresh_tokens AS token SET revoked_at = COALESCE(token.revoked_at, now())
         FROM auth_sessions AS session
         WHERE token.session_id = session.id AND session.user_id = $1 AND session.id <> $2`,
        [input.userId, input.currentSessionId],
      );
    });
  }

  async deactivateUser(userId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(`UPDATE users SET deleted_at = COALESCE(deleted_at, now()), updated_at = now() WHERE id = $1`, [userId]);
      await revokeAllUserSessions(client, userId);
    });
  }

  async requestPermanentDeletion(userId: string): Promise<{ requestId: string }> {
    return transaction(this.pool, async (client) => {
      const request = await client.query<{ request_id: string } & QueryResultRow>(
        `INSERT INTO account_deletion_requests (user_id, status)
         VALUES ($1, 'pending')
         ON CONFLICT (user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET requested_at = now(), status = 'pending', completed_at = NULL,
           attempt_count = 0, next_attempt_at = now(), processing_started_at = NULL,
           last_error_code = NULL
         RETURNING request_id`, [userId]);
      await client.query(`UPDATE users SET deleted_at = COALESCE(deleted_at, now()), updated_at = now() WHERE id = $1`, [userId]);
      await revokeAllUserSessions(client, userId);
      return { requestId: request.rows[0].request_id };
    });
  }

  async createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    authenticatedAt?: Date;
  }): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO auth_sessions
          (id, user_id, refresh_token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.id, input.userId, input.refreshTokenHash, input.expiresAt, input.authenticatedAt ?? new Date()],
      );
      await client.query(
        `INSERT INTO auth_refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [input.id, input.refreshTokenHash, input.expiresAt],
      );
    });
  }

  async rotateRefreshToken(input: {
    presentedTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
  }): Promise<RefreshResult> {
    return transaction(this.pool, async (client) => {
      const found = await client.query<RefreshTokenRow>(
        `SELECT token.session_id, session.user_id, users.email, users.name,
                token.consumed_at, token.revoked_at AS token_revoked_at,
                token.expires_at > now() AS token_is_unexpired,
                session.revoked_at AS session_revoked_at,
                session.expires_at AS session_expires_at,
                session.expires_at > now() AS session_is_unexpired,
                users.deleted_at AS user_deleted_at,
                session.created_at AS session_authenticated_at
         FROM auth_refresh_tokens AS token
         JOIN auth_sessions AS session ON session.id = token.session_id
         JOIN users ON users.id = session.user_id
         WHERE token.token_hash = $1
         FOR UPDATE OF token, session`,
        [input.presentedTokenHash],
      );
      const token = found.rows[0];
      if (!token) {
        return { kind: "invalid" };
      }

      if (token.consumed_at && token.token_is_unexpired) {
        await client.query(
          `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
           WHERE id = $1`,
          [token.session_id],
        );
        await client.query(
          `UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
           WHERE session_id = $1`,
          [token.session_id],
        );
        return { kind: "reused" };
      }

      if (
        !token.token_is_unexpired ||
        token.token_revoked_at ||
        token.session_revoked_at ||
        !token.session_is_unexpired ||
        token.user_deleted_at
      ) {
        return { kind: "invalid" };
      }

      await client.query(
        `UPDATE auth_refresh_tokens SET consumed_at = now()
         WHERE token_hash = $1 AND consumed_at IS NULL`,
        [input.presentedTokenHash],
      );
      await client.query(
        `UPDATE auth_sessions
         SET refresh_token_hash = $2, expires_at = $3, updated_at = now()
         WHERE id = $1`,
        [token.session_id, input.nextTokenHash, input.nextExpiresAt],
      );
      await client.query(
        `INSERT INTO auth_refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [token.session_id, input.nextTokenHash, input.nextExpiresAt],
      );

      const session: AuthSession = {
        id: token.session_id,
        user: { id: token.user_id, email: token.email, name: token.name },
        authenticatedAt: token.session_authenticated_at,
      };
      return { kind: "rotated", session };
    });
  }

  async revokeSession(input: {
    sessionId: string;
    userId: string;
  }): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [input.sessionId, input.userId],
      );
      await client.query(
        `UPDATE auth_refresh_tokens AS token
         SET revoked_at = COALESCE(token.revoked_at, now())
         FROM auth_sessions AS session
         WHERE token.session_id = session.id
           AND session.id = $1 AND session.user_id = $2`,
        [input.sessionId, input.userId],
      );
    });
  }

  async isSessionActive(input: {
    sessionId: string;
    userId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM auth_sessions AS session
       JOIN users ON users.id = session.user_id
       WHERE session.id = $1
         AND session.user_id = $2
         AND session.revoked_at IS NULL
         AND session.expires_at > now()
         AND users.deleted_at IS NULL`,
      [input.sessionId, input.userId],
    );
    return result.rowCount === 1;
  }
}

async function revokeAllUserSessions(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE user_id = $1`,
    [userId],
  );
  await client.query(
    `UPDATE auth_refresh_tokens AS token SET revoked_at = COALESCE(token.revoked_at, now())
     FROM auth_sessions AS session WHERE token.session_id = session.id AND session.user_id = $1`,
    [userId],
  );
}

function isEmailUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505" && "constraint" in error && error.constraint === "users_email_unique_idx";
}

function isIdentityUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "23505" || !("constraint" in error)) {
    return false;
  }
  return error.constraint === "auth_identities_provider_subject_unique" ||
    error.constraint === "auth_identities_user_provider_unique";
}

function toAuthUser(row: DatabaseUser): AuthUser {
  return { id: row.id, email: row.email, name: row.name };
}
