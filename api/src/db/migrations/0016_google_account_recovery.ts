import type { Migration } from "./types.js";

const migration: Migration = {
  version: 16,
  name: "google_account_recovery",
  async up(client) {
    await client.query(`
      ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

      CREATE TABLE auth_oauth_account_recovery_challenges (
        flow_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_subject text NOT NULL CHECK (length(provider_subject) > 0),
        provider_email text NOT NULL,
        provider_name text NOT NULL,
        code_hash text NOT NULL CHECK (length(code_hash) = 64),
        attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_oauth_account_recovery_challenges_expiry_idx
        ON auth_oauth_account_recovery_challenges (expires_at)
        WHERE consumed_at IS NULL;
      CREATE UNIQUE INDEX auth_oauth_account_recovery_challenges_active_user_idx
        ON auth_oauth_account_recovery_challenges (user_id)
        WHERE consumed_at IS NULL;
    `);
  },
};

export default migration;
