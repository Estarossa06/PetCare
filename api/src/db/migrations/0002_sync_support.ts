import type { Migration } from "./types.js";

const migration: Migration = {
  version: 2,
  name: "sync_support",
  async up(client) {
    await client.query(`
      CREATE TABLE sync_devices (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        device_name text,
        last_download_cursor bigint NOT NULL DEFAULT 0,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sync_devices_user_id_id_unique UNIQUE (user_id, id),
        CONSTRAINT sync_devices_cursor_nonnegative CHECK (last_download_cursor >= 0)
      );
      CREATE INDEX sync_devices_user_active_idx
        ON sync_devices (user_id, last_seen_at DESC) WHERE revoked_at IS NULL;

      CREATE TABLE sync_operations (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        operation_id uuid NOT NULL,
        request_hash char(64) NOT NULL,
        response jsonb NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, operation_id),
        CONSTRAINT sync_operations_hash_length CHECK (length(request_hash) = 64),
        CONSTRAINT sync_operations_response_object CHECK (jsonb_typeof(response) = 'object')
      );
      CREATE INDEX sync_operations_processed_idx ON sync_operations (processed_at);

      CREATE TABLE sync_changes (
        cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        entity_type text NOT NULL,
        entity_id uuid NOT NULL,
        entity_version integer NOT NULL,
        operation_id uuid,
        change_type text NOT NULL,
        changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sync_changes_operation_fk
          FOREIGN KEY (owner_id, operation_id)
          REFERENCES sync_operations(user_id, operation_id) ON DELETE RESTRICT,
        CONSTRAINT sync_changes_entity_type_valid CHECK (
          entity_type IN ('pet', 'health_record', 'health_attachment', 'care_task',
            'appointment', 'reminder', 'ai_conversation', 'ai_message')
        ),
        CONSTRAINT sync_changes_entity_version_positive CHECK (entity_version > 0),
        CONSTRAINT sync_changes_type_valid CHECK (change_type IN ('upsert', 'delete')),
        CONSTRAINT sync_changes_fields_array CHECK (jsonb_typeof(changed_fields) = 'array')
      );
      CREATE INDEX sync_changes_owner_cursor_idx ON sync_changes (owner_id, cursor);
      CREATE INDEX sync_changes_entity_idx
        ON sync_changes (owner_id, entity_type, entity_id, cursor DESC);
    `);
  },
};

export default migration;
