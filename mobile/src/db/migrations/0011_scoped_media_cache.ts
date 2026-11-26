import type { SqliteMigration } from "./types.ts";

const migration: SqliteMigration = {
  version: 11,
  name: "scoped_remote_media_cache",
  async up(db) {
    await db.execAsync(`
      ALTER TABLE sync_metadata ADD COLUMN media_cache_key_version INTEGER NOT NULL DEFAULT 0
        CHECK (media_cache_key_version >= 0);
    `);
  },
};

export default migration;
