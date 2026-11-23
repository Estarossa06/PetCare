import type { Migration } from "./types.js";

const migration: Migration = {
  version: 3,
  name: "ordered_sync_cursors",
  async up(client) {
    await client.query(`
      CREATE TABLE sync_cursors (
        owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
        last_cursor bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sync_cursors_last_cursor_nonnegative CHECK (last_cursor >= 0)
      );

      ALTER TABLE sync_changes
        DROP CONSTRAINT sync_changes_pkey;
      ALTER TABLE sync_changes
        ALTER COLUMN cursor DROP IDENTITY;
      UPDATE sync_devices AS devices
      SET last_download_cursor = (
        SELECT count(*)
        FROM sync_changes AS changes
        WHERE changes.owner_id = devices.user_id
          AND changes.cursor <= devices.last_download_cursor
      );
      WITH ordered_changes AS (
        SELECT owner_id, cursor,
          row_number() OVER (PARTITION BY owner_id ORDER BY cursor) AS owner_cursor
        FROM sync_changes
      )
      UPDATE sync_changes AS changes
      SET cursor = ordered_changes.owner_cursor
      FROM ordered_changes
      WHERE changes.owner_id = ordered_changes.owner_id
        AND changes.cursor = ordered_changes.cursor;

      INSERT INTO sync_cursors (owner_id, last_cursor)
      SELECT owner_id, max(cursor)
      FROM sync_changes
      GROUP BY owner_id;

      ALTER TABLE sync_changes
        ADD CONSTRAINT sync_changes_pkey PRIMARY KEY (owner_id, cursor);
      DROP INDEX sync_changes_owner_cursor_idx;
    `);
  },
};

export default migration;
