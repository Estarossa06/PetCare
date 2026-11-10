import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  DuplicateEmailError,
  type AuthSession,
  type AuthStore,
  type AuthUser,
  type RefreshResult,
} from "./types.js";

interface DatabaseUser extends QueryResultRow {
  id: string;
  email: string;
  name: string;
  password_hash?: string;
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
            (id, user_id, refresh_token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [
            input.sessionId,
            result.rows[0].id,
            input.refreshTokenHash,
            input.expiresAt,
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
  ): Promise<(AuthUser & { passwordHash: string }) | undefined> {
    const result = await this.pool.query<DatabaseUser>(
      `SELECT id, email, name, password_hash
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    const row = result.rows[0];
    return row
      ? { ...toAuthUser(row), passwordHash: row.password_hash ?? "" }
      : undefined;
  }

  async createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO auth_sessions
          (id, user_id, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.id, input.userId, input.refreshTokenHash, input.expiresAt],
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
                users.deleted_at AS user_deleted_at
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

function toAuthUser(row: DatabaseUser): AuthUser {
  return { id: row.id, email: row.email, name: row.name };
}
