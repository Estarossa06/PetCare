import type { Migration } from "./types.js";

const migration: Migration = {
  version: 4,
  name: "auth_refresh_token_history",
  async up(client) {
    await client.query(`
      ALTER TABLE auth_sessions
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

      CREATE TABLE auth_refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        revoked_at timestamptz,
        CONSTRAINT auth_refresh_tokens_hash_nonempty CHECK (length(token_hash) > 0),
        CONSTRAINT auth_refresh_tokens_expiry_after_creation CHECK (expires_at > created_at)
      );
      CREATE UNIQUE INDEX auth_refresh_tokens_hash_unique_idx
        ON auth_refresh_tokens (token_hash);
      CREATE INDEX auth_refresh_tokens_session_idx
        ON auth_refresh_tokens (session_id, created_at DESC);

      INSERT INTO auth_refresh_tokens
        (session_id, token_hash, created_at, expires_at, revoked_at)
      SELECT id, refresh_token_hash, created_at, expires_at, revoked_at
      FROM auth_sessions;
    `);
  },
};

export default migration;
