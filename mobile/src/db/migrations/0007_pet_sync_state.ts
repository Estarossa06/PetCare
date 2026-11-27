import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 7,
  name: "pet_sync_state",
  async up(db) {
    await db.execAsync(`
      ALTER TABLE pets ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0 CHECK (local_revision >= 0);
      ALTER TABLE pets ADD COLUMN server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0);
      ALTER TABLE pets ADD COLUMN acknowledged_local_revision INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged_local_revision >= 0);
      ALTER TABLE sync_queue ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0 CHECK (local_revision >= 0);
      ALTER TABLE sync_metadata ADD COLUMN device_id TEXT
        CHECK (device_id IS NULL OR (
          device_id = lower(device_id) AND device_id GLOB '????????-????-????-????-????????????'
          AND length(replace(device_id, '-', '')) = 32
          AND replace(device_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ));
      CREATE UNIQUE INDEX sync_metadata_device_id_unique_idx
        ON sync_metadata (device_id) WHERE device_id IS NOT NULL;

      UPDATE pets SET local_revision = (
        SELECT count(*) FROM sync_queue q
        WHERE q.account_id = pets.owner_id AND q.entity_type = 'pet' AND q.entity_id = pets.id
      );
      UPDATE sync_queue AS current SET
        local_revision = (
          SELECT count(*) FROM sync_queue earlier
          WHERE earlier.account_id = current.account_id AND earlier.entity_type = current.entity_type
            AND earlier.entity_id = current.entity_id AND earlier.rowid <= current.rowid
        ),
        base_version = (
          SELECT count(*) FROM sync_queue earlier
          WHERE earlier.account_id = current.account_id AND earlier.entity_type = current.entity_type
            AND earlier.entity_id = current.entity_id AND earlier.rowid < current.rowid
        )
        WHERE current.entity_type = 'pet';
    `);
  },
};

export default migration;
