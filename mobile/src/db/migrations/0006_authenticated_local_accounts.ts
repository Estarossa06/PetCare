import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 6,
  name: "authenticated_local_accounts",
  async up(db) {
    await db.execAsync(`
      ALTER TABLE sync_metadata ADD COLUMN auth_user_id TEXT
        CHECK (auth_user_id IS NULL OR (
          auth_user_id = lower(auth_user_id)
          AND auth_user_id GLOB '????????-????-????-????-????????????'
          AND length(replace(auth_user_id, '-', '')) = 32
          AND replace(auth_user_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ));
      CREATE UNIQUE INDEX sync_metadata_auth_user_id_unique_idx
        ON sync_metadata (auth_user_id) WHERE auth_user_id IS NOT NULL;
    `);
  },
};

export default migration;
