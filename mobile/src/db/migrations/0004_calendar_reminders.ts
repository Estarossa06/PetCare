import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 4,
  name: "calendar_events_and_reminders",
  async up(db) {
    await db.execAsync(`
      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description TEXT,
        category TEXT NOT NULL CHECK (category IN ('custom', 'birthday', 'travel', 'grooming', 'other')),
        starts_at TEXT NOT NULL,
        ends_at TEXT,
        timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
        observations TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        CHECK (ends_at IS NULL OR ends_at > starts_at),
        FOREIGN KEY (owner_id, pet_id) REFERENCES pets (owner_id, id)
      );
      CREATE INDEX calendar_events_owner_start_idx
        ON calendar_events (owner_id, starts_at) WHERE deleted_at IS NULL;
      CREATE INDEX calendar_events_pet_start_idx
        ON calendar_events (owner_id, pet_id, starts_at) WHERE deleted_at IS NULL;

      CREATE TABLE calendar_reminders (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        pet_id TEXT,
        calendar_event_id TEXT,
        care_task_id TEXT,
        appointment_id TEXT,
        health_record_id TEXT,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        remind_at TEXT NOT NULL,
        lead_minutes INTEGER CHECK (lead_minutes IS NULL OR lead_minutes >= 0),
        timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'attended', 'cancelled')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        notes TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        CHECK (
          (calendar_event_id IS NOT NULL) +
          (care_task_id IS NOT NULL) +
          (appointment_id IS NOT NULL) +
          (health_record_id IS NOT NULL) = 1
        ),
        FOREIGN KEY (owner_id, pet_id) REFERENCES pets (owner_id, id),
        FOREIGN KEY (owner_id, calendar_event_id) REFERENCES calendar_events (owner_id, id),
        FOREIGN KEY (owner_id, care_task_id, pet_id) REFERENCES care_tasks (owner_id, id, pet_id),
        FOREIGN KEY (owner_id, appointment_id, pet_id) REFERENCES appointments (owner_id, id, pet_id),
        FOREIGN KEY (owner_id, health_record_id, pet_id) REFERENCES health_records (owner_id, id, pet_id)
      );
      CREATE INDEX calendar_reminders_due_idx
        ON calendar_reminders (owner_id, remind_at) WHERE status = 'pending' AND enabled = 1 AND deleted_at IS NULL;
      CREATE INDEX calendar_reminders_event_idx
        ON calendar_reminders (owner_id, calendar_event_id) WHERE deleted_at IS NULL;

      CREATE TABLE calendar_scheduled_notifications (
        reminder_id TEXT PRIMARY KEY NOT NULL,
        operating_system_id TEXT,
        scheduled_version INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_version >= 0),
        scheduled_for TEXT,
        scheduling_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (scheduling_status IN ('pending', 'scheduled', 'denied', 'unsupported', 'expired', 'failed', 'disabled')),
        last_error TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (reminder_id) REFERENCES calendar_reminders (id) ON DELETE CASCADE
      );

      PRAGMA defer_foreign_keys = ON;
      CREATE TABLE sync_queue_v4 (
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
          'pet', 'health_record', 'health_attachment', 'care_task', 'care_execution',
          'appointment', 'reminder', 'calendar_event', 'calendar_reminder',
          'ai_conversation', 'ai_message'
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
      INSERT INTO sync_queue_v4 SELECT * FROM sync_queue;

      CREATE TABLE sync_queue_dependencies_v4 (
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
          REFERENCES sync_queue_v4 (account_id, operation_id) ON DELETE CASCADE,
        FOREIGN KEY (account_id, depends_on_operation_id)
          REFERENCES sync_queue_v4 (account_id, operation_id) ON DELETE RESTRICT,
        CHECK (operation_id <> depends_on_operation_id)
      );
      INSERT INTO sync_queue_dependencies_v4 SELECT * FROM sync_queue_dependencies;

      CREATE TABLE sync_conflicts_v4 (
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
          'pet', 'health_record', 'health_attachment', 'care_task', 'care_execution',
          'appointment', 'reminder', 'calendar_event', 'calendar_reminder',
          'ai_conversation', 'ai_message'
        )),
        UNIQUE (account_id, operation_id),
        FOREIGN KEY (account_id, operation_id)
          REFERENCES sync_queue_v4 (account_id, operation_id) ON DELETE RESTRICT
      );
      INSERT INTO sync_conflicts_v4 SELECT * FROM sync_conflicts;

      DROP TABLE sync_queue_dependencies;
      DROP TABLE sync_conflicts;
      DROP TABLE sync_queue;
      ALTER TABLE sync_queue_v4 RENAME TO sync_queue;
      ALTER TABLE sync_queue_dependencies_v4 RENAME TO sync_queue_dependencies;
      ALTER TABLE sync_conflicts_v4 RENAME TO sync_conflicts;
      CREATE INDEX sync_queue_ready_idx
        ON sync_queue (account_id, status, next_retry_at, created_at);
      CREATE INDEX sync_queue_entity_idx
        ON sync_queue (account_id, entity_type, entity_id, created_at);
      CREATE INDEX sync_conflicts_open_idx
        ON sync_conflicts (account_id, status, created_at);
    `);
  },
};

export default migration;
