import type { Migration } from "./types.js";

const migration: Migration = {
  version: 15,
  name: "google_account_link_challenges",
  async up(client) {
    await client.query(`
      CREATE TABLE auth_oauth_account_link_challenges (
        challenge_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_subject text NOT NULL CHECK (length(provider_subject) > 0),
        provider_email text NOT NULL,
        provider_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_oauth_account_link_challenges_expiry_idx
        ON auth_oauth_account_link_challenges (expires_at)
        WHERE consumed_at IS NULL;
    `);
  },
};

export default migration;
