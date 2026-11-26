import type { Migration } from "./types.js";

const migration: Migration = {
  version: 13,
  name: "account_deletion_worker",
  async up(client) {
    await client.query(`
      ALTER TABLE account_deletion_requests
        ADD COLUMN request_id uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
        ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN processing_started_at timestamptz,
        ADD COLUMN last_error_code text;

      ALTER TABLE account_deletion_requests
        DROP CONSTRAINT account_deletion_requests_pkey,
        DROP CONSTRAINT account_deletion_requests_user_id_fkey,
        ALTER COLUMN user_id DROP NOT NULL,
        ADD CONSTRAINT account_deletion_requests_pkey PRIMARY KEY (request_id),
        ADD CONSTRAINT account_deletion_requests_attempt_count_nonnegative CHECK (attempt_count >= 0);

      CREATE UNIQUE INDEX account_deletion_requests_active_user_idx
        ON account_deletion_requests(user_id) WHERE user_id IS NOT NULL;
      CREATE INDEX account_deletion_requests_due_idx
        ON account_deletion_requests(next_attempt_at, requested_at)
        WHERE status IN ('pending','processing') AND user_id IS NOT NULL;
    `);
  },
};

export default migration;
