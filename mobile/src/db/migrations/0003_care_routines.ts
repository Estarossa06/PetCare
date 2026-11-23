import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 3,
  name: "care_routines_and_execution_history",
  async up(db) {
    await db.execAsync(`
      ALTER TABLE care_tasks ADD COLUMN category TEXT NOT NULL DEFAULT 'custom'
        CHECK (category IN (
          'feeding', 'walk', 'bath', 'hygiene', 'medication', 'vaccination',
          'deworming', 'exercise', 'custom'
        ));
      ALTER TABLE care_tasks ADD COLUMN description TEXT;
      ALTER TABLE care_tasks ADD COLUMN observations TEXT;
      ALTER TABLE care_tasks ADD COLUMN schedule_json TEXT NOT NULL
        DEFAULT '{"frequency":"once","interval":1,"unit":"days"}'
        CHECK (json_valid(schedule_json) AND json_type(schedule_json) = 'object');
      ALTER TABLE care_tasks ADD COLUMN next_run_at TEXT;
      ALTER TABLE care_tasks ADD COLUMN ends_at TEXT;
      UPDATE care_tasks SET category = task_type, next_run_at = starts_at;
      CREATE INDEX care_tasks_next_run_idx
        ON care_tasks (owner_id, pet_id, next_run_at)
        WHERE enabled = 1 AND deleted_at IS NULL;

      CREATE TABLE care_task_executions (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          id = lower(id) AND id GLOB '????????-????-????-????-????????????'
          AND length(replace(id, '-', '')) = 32 AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
        owner_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        executed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('completed', 'omitted', 'cancelled')),
        notes TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, id, task_id, pet_id),
        UNIQUE (owner_id, task_id, scheduled_for),
        CHECK (
          (status = 'completed' AND executed_at IS NOT NULL)
          OR (status <> 'completed' AND executed_at IS NULL)
        ),
        FOREIGN KEY (owner_id, task_id, pet_id)
          REFERENCES care_tasks (owner_id, id, pet_id)
      );
      CREATE INDEX care_task_executions_pet_time_idx
        ON care_task_executions (owner_id, pet_id, executed_at DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX care_task_executions_task_schedule_idx
        ON care_task_executions (owner_id, task_id, scheduled_for DESC)
        WHERE deleted_at IS NULL;

      PRAGMA defer_foreign_keys = ON;
      CREATE TABLE sync_queue_v3 (
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
      INSERT INTO sync_queue_v3 SELECT * FROM sync_queue;

      CREATE TABLE sync_queue_dependencies_v3 (
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
          REFERENCES sync_queue_v3 (account_id, operation_id) ON DELETE CASCADE,
        FOREIGN KEY (account_id, depends_on_operation_id)
          REFERENCES sync_queue_v3 (account_id, operation_id) ON DELETE RESTRICT,
        CHECK (operation_id <> depends_on_operation_id)
      );
      INSERT INTO sync_queue_dependencies_v3 SELECT * FROM sync_queue_dependencies;

      CREATE TABLE sync_conflicts_v3 (
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
          'appointment', 'reminder', 'ai_conversation', 'ai_message'
        )),
        UNIQUE (account_id, operation_id),
        FOREIGN KEY (account_id, operation_id)
          REFERENCES sync_queue_v3 (account_id, operation_id) ON DELETE RESTRICT
      );
      INSERT INTO sync_conflicts_v3 SELECT * FROM sync_conflicts;

      DROP TABLE sync_queue_dependencies;
      DROP TABLE sync_conflicts;
      DROP TABLE sync_queue;
      ALTER TABLE sync_queue_v3 RENAME TO sync_queue;
      ALTER TABLE sync_queue_dependencies_v3 RENAME TO sync_queue_dependencies;
      ALTER TABLE sync_conflicts_v3 RENAME TO sync_conflicts;

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
