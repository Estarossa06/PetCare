import type { Migration } from "./types.js";

const migration: Migration = {
  version: 5,
  name: "pet_sync_protocol",
  async up(client) {
    await client.query(`
      ALTER TABLE sync_devices
        ADD COLUMN platform text NOT NULL DEFAULT 'other',
        ADD COLUMN app_version text,
        ADD COLUMN schema_version integer NOT NULL DEFAULT 0;
      ALTER TABLE sync_devices
        ADD CONSTRAINT sync_devices_platform_valid
          CHECK (platform IN ('ios', 'android', 'web', 'other')),
        ADD CONSTRAINT sync_devices_schema_version_nonnegative
          CHECK (schema_version >= 0);

      CREATE FUNCTION record_pet_sync_change() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        next_cursor bigint;
        operation_id uuid;
        fields jsonb;
      BEGIN
        operation_id := nullif(current_setting('petcare.sync_operation_id', true), '')::uuid;
        fields := coalesce(nullif(current_setting('petcare.sync_changed_fields', true), '')::jsonb, '[]'::jsonb);
        INSERT INTO sync_cursors (owner_id, last_cursor)
        VALUES (NEW.owner_id, 1)
        ON CONFLICT (owner_id) DO UPDATE
          SET last_cursor = sync_cursors.last_cursor + 1,
              updated_at = now()
        RETURNING last_cursor INTO next_cursor;

        INSERT INTO sync_changes
          (owner_id, cursor, entity_type, entity_id, entity_version,
           operation_id, change_type, changed_fields)
        VALUES
          (NEW.owner_id, next_cursor, 'pet', NEW.id, NEW.version,
           operation_id, CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,
           fields);
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER pets_record_sync_change
      AFTER INSERT OR UPDATE ON pets
      FOR EACH ROW EXECUTE FUNCTION record_pet_sync_change();

      -- Publish a baseline for pets that predate this protocol, including rows
      -- created through the existing /pets API before this migration.
      UPDATE pets SET updated_at = updated_at;
    `);
  },
};

export default migration;
