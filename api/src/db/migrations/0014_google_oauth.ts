import type { Migration } from "./types.js";

const migration: Migration = {
  version: 14,
  name: "google_oauth_identities",
  async up(client) {
    await client.query(`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
      ALTER TABLE users DROP CONSTRAINT users_password_hash_nonempty;
      ALTER TABLE users ADD CONSTRAINT users_password_hash_nonempty
        CHECK (password_hash IS NULL OR length(password_hash) > 0);

      CREATE TABLE auth_identities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider text NOT NULL CHECK (provider = 'google'),
        provider_subject text NOT NULL CHECK (length(provider_subject) > 0),
        provider_email text NOT NULL,
        email_verified boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, provider_subject),
        CONSTRAINT auth_identities_user_provider_unique UNIQUE (user_id, provider)
      );
      CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

      CREATE TABLE auth_oauth_transactions (
        state_hash text PRIMARY KEY,
        nonce_hash text NOT NULL,
        code_verifier text NOT NULL,
        mode text NOT NULL CHECK (mode IN ('login', 'link')),
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        session_id uuid REFERENCES auth_sessions(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CHECK ((mode = 'login' AND user_id IS NULL AND session_id IS NULL)
          OR (mode = 'link' AND user_id IS NOT NULL AND session_id IS NOT NULL)),
        CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_oauth_transactions_expiry_idx ON auth_oauth_transactions (expires_at);

      CREATE TABLE auth_oauth_link_intents (
        intent_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_oauth_link_intents_expiry_idx ON auth_oauth_link_intents (expires_at)
        WHERE consumed_at IS NULL;

      CREATE TABLE auth_oauth_handoffs (
        code_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_oauth_handoffs_expiry_idx ON auth_oauth_handoffs (expires_at)
        WHERE consumed_at IS NULL;
    `);
  },
};

export default migration;
