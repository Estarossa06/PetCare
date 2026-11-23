import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 1,
  name: "initial",
  async up(db) {
    await db.execAsync(`
      CREATE TABLE pets (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL CHECK (
          owner_id = lower(owner_id) AND owner_id GLOB '????????-????-????-????-????????????'
          AND length(replace(owner_id, '-', '')) = 32
          AND replace(owner_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        species TEXT NOT NULL CHECK (length(trim(species)) > 0),
        breed TEXT,
        sex TEXT CHECK (sex IS NULL OR sex IN ('female', 'male', 'unknown')),
        birth_date TEXT,
        approximate_age_months INTEGER CHECK (approximate_age_months IS NULL OR approximate_age_months >= 0),
        weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg > 0),
        color TEXT,
        notes TEXT,
        photo_storage_key TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id)
      );
      CREATE INDEX pets_owner_updated_idx ON pets (owner_id, updated_at DESC);

      CREATE TABLE health_records (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        record_type TEXT NOT NULL CHECK (record_type IN (
          'consultation', 'vaccination', 'deworming', 'medication',
          'treatment', 'surgery', 'allergy', 'diagnosis', 'observation'
        )),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description TEXT,
        occurred_at TEXT NOT NULL,
        professional_name TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, id, pet_id),
        FOREIGN KEY (owner_id, pet_id) REFERENCES pets (owner_id, id)
      );
      CREATE INDEX health_records_pet_date_idx
        ON health_records (owner_id, pet_id, occurred_at DESC);

      CREATE TABLE health_attachments (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        health_record_id TEXT NOT NULL,
        storage_key TEXT NOT NULL CHECK (length(trim(storage_key)) > 0),
        local_uri TEXT,
        original_filename TEXT NOT NULL CHECK (length(trim(original_filename)) > 0),
        mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        FOREIGN KEY (owner_id, health_record_id, pet_id)
          REFERENCES health_records (owner_id, id, pet_id)
      );
      CREATE INDEX health_attachments_record_idx
        ON health_attachments (owner_id, health_record_id);

      CREATE TABLE care_tasks (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        task_type TEXT NOT NULL CHECK (task_type IN (
          'feeding', 'hygiene', 'bath', 'walk', 'medication',
          'deworming', 'vaccination', 'custom'
        )),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        notes TEXT,
        recurrence_rule TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(trim(timezone)) > 0),
        starts_at TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, id, pet_id),
        FOREIGN KEY (owner_id, pet_id) REFERENCES pets (owner_id, id)
      );
      CREATE INDEX care_tasks_pet_enabled_idx
        ON care_tasks (owner_id, pet_id, starts_at)
        WHERE enabled = 1 AND deleted_at IS NULL;

      CREATE TABLE appointments (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        starts_at TEXT NOT NULL,
        ends_at TEXT,
        location TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled', 'completed', 'cancelled')),
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, id, pet_id),
        CHECK (ends_at IS NULL OR ends_at > starts_at),
        FOREIGN KEY (owner_id, pet_id) REFERENCES pets (owner_id, id)
      );
      CREATE INDEX appointments_pet_start_idx
        ON appointments (owner_id, pet_id, starts_at) WHERE deleted_at IS NULL;

      CREATE TABLE reminders (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        care_task_id TEXT,
        appointment_id TEXT,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        due_at TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(trim(timezone)) > 0),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'completed', 'cancelled')),
        notes TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        CHECK (care_task_id IS NULL OR appointment_id IS NULL),
        FOREIGN KEY (owner_id, pet_id) REFERENCES pets (owner_id, id),
        FOREIGN KEY (owner_id, care_task_id, pet_id)
          REFERENCES care_tasks (owner_id, id, pet_id),
        FOREIGN KEY (owner_id, appointment_id, pet_id)
          REFERENCES appointments (owner_id, id, pet_id)
      );
      CREATE INDEX reminders_pet_due_idx
        ON reminders (owner_id, pet_id, due_at)
        WHERE status = 'pending' AND deleted_at IS NULL;

      CREATE TABLE ai_conversations (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        title TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, id, pet_id),
        FOREIGN KEY (owner_id, pet_id) REFERENCES pets (owner_id, id)
      );
      CREATE INDEX ai_conversations_pet_updated_idx
        ON ai_conversations (owner_id, pet_id, updated_at DESC);

      CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        FOREIGN KEY (owner_id, conversation_id, pet_id)
          REFERENCES ai_conversations (owner_id, id, pet_id)
      );
      CREATE INDEX ai_messages_conversation_created_idx
        ON ai_messages (owner_id, conversation_id, created_at);

      CREATE TABLE sync_metadata (
        account_id TEXT PRIMARY KEY NOT NULL CHECK (
          account_id = lower(account_id)
          AND account_id GLOB '????????-????-????-????-????????????'
          AND length(replace(account_id, '-', '')) = 32
          AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        last_download_cursor INTEGER NOT NULL DEFAULT 0 CHECK (last_download_cursor >= 0),
        last_successful_sync_at TEXT,
        schema_version INTEGER NOT NULL DEFAULT 0 CHECK (schema_version >= 0),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sync_queue (
        operation_id TEXT PRIMARY KEY NOT NULL CHECK (
          operation_id = lower(operation_id)
          AND operation_id GLOB '????????-????-????-????-????????????'
          AND length(replace(operation_id, '-', '')) = 32
          AND replace(operation_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        account_id TEXT NOT NULL CHECK (
          account_id = lower(account_id)
          AND account_id GLOB '????????-????-????-????-????????????'
          AND length(replace(account_id, '-', '')) = 32
          AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        entity_type TEXT NOT NULL CHECK (entity_type IN (
          'pet', 'health_record', 'health_attachment', 'care_task',
          'appointment', 'reminder', 'ai_conversation', 'ai_message'
        )),
        entity_id TEXT NOT NULL CHECK (
          entity_id = lower(entity_id) AND entity_id GLOB '????????-????-????-????-????????????'
          AND length(replace(entity_id, '-', '')) = 32
          AND replace(entity_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        base_version INTEGER NOT NULL DEFAULT 0 CHECK (base_version >= 0),
        changed_fields TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(changed_fields) AND json_type(changed_fields) = 'array'),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_flight', 'blocked', 'conflict', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_retry_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (account_id, operation_id)
      );
      CREATE INDEX sync_queue_ready_idx
        ON sync_queue (account_id, status, next_retry_at, created_at);
      CREATE INDEX sync_queue_entity_idx
        ON sync_queue (account_id, entity_type, entity_id, created_at);

      CREATE TABLE sync_queue_dependencies (
        account_id TEXT NOT NULL CHECK (
          account_id = lower(account_id)
          AND account_id GLOB '????????-????-????-????-????????????'
          AND length(replace(account_id, '-', '')) = 32
          AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        operation_id TEXT NOT NULL,
        depends_on_operation_id TEXT NOT NULL,
        PRIMARY KEY (account_id, operation_id, depends_on_operation_id),
        FOREIGN KEY (account_id, operation_id)
          REFERENCES sync_queue (account_id, operation_id) ON DELETE CASCADE,
        FOREIGN KEY (account_id, depends_on_operation_id)
          REFERENCES sync_queue (account_id, operation_id) ON DELETE RESTRICT,
        CHECK (operation_id <> depends_on_operation_id)
      );

      CREATE TABLE sync_conflicts (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        account_id TEXT NOT NULL CHECK (
          account_id = lower(account_id)
          AND account_id GLOB '????????-????-????-????-????????????'
          AND length(replace(account_id, '-', '')) = 32
          AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        operation_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL CHECK (
          entity_id = lower(entity_id) AND entity_id GLOB '????????-????-????-????-????????????'
          AND length(replace(entity_id, '-', '')) = 32
          AND replace(entity_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        base_version INTEGER NOT NULL CHECK (base_version >= 0),
        server_version INTEGER NOT NULL CHECK (server_version > 0),
        local_snapshot TEXT NOT NULL CHECK (json_valid(local_snapshot)),
        server_snapshot TEXT NOT NULL CHECK (json_valid(server_snapshot)),
        conflicting_fields TEXT NOT NULL
          CHECK (json_valid(conflicting_fields) AND json_type(conflicting_fields) = 'array'),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'discarded')),
        resolution TEXT CHECK (resolution IS NULL OR json_valid(resolution)),
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        CHECK (entity_type IN (
          'pet', 'health_record', 'health_attachment', 'care_task',
          'appointment', 'reminder', 'ai_conversation', 'ai_message'
        )),
        UNIQUE (account_id, operation_id),
        FOREIGN KEY (account_id, operation_id)
          REFERENCES sync_queue (account_id, operation_id) ON DELETE RESTRICT
      );
      CREATE INDEX sync_conflicts_open_idx
        ON sync_conflicts (account_id, status, created_at);

      CREATE TABLE scheduled_notifications (
        reminder_id TEXT PRIMARY KEY NOT NULL CHECK (
          reminder_id = lower(reminder_id)
          AND reminder_id GLOB '????????-????-????-????-????????????'
          AND length(replace(reminder_id, '-', '')) = 32
          AND replace(reminder_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        operating_system_id TEXT NOT NULL,
        scheduled_version INTEGER NOT NULL CHECK (scheduled_version > 0),
        scheduled_for TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (reminder_id) REFERENCES reminders (id) ON DELETE CASCADE
      );

    `);
  },
};

export default migration;
