import type { Migration } from "./types.js";

const migration: Migration = {
  version: 9,
  name: "account_lifecycle",
  async up(client) {
    await client.query(`
      CREATE TABLE account_deletion_requests (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
        requested_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'pending',
        completed_at timestamptz,
        CONSTRAINT account_deletion_requests_status_valid
          CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
        CONSTRAINT account_deletion_requests_completion_valid
          CHECK ((status = 'completed') = (completed_at IS NOT NULL))
      );
    `);
  },
};

export default migration;
