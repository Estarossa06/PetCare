import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 8,
  name: "domain_sync_state",
  async up(db) {
    await db.execAsync("ALTER TABLE sync_metadata ADD COLUMN domain_download_cursor INTEGER NOT NULL DEFAULT 0 CHECK (domain_download_cursor >= 0)");
    await db.execAsync("ALTER TABLE appointments ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'");
    for (const table of ["health_records", "care_tasks", "care_task_executions", "appointments", "calendar_events", "calendar_reminders"]) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0 CHECK (local_revision >= 0)`);
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0)`);
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN acknowledged_local_revision INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged_local_revision >= 0)`);
    }
    await db.execAsync(`
      UPDATE sync_queue SET status='failed',last_error='REMOTE_FILE_STORAGE_NOT_CONFIGURED',updated_at=datetime('now')
        WHERE entity_type='health_attachment' AND status IN ('pending','in_flight','blocked');
      UPDATE sync_queue SET local_revision = (
        SELECT count(*) FROM sync_queue earlier WHERE earlier.account_id=sync_queue.account_id
          AND earlier.entity_type=sync_queue.entity_type AND earlier.entity_id=sync_queue.entity_id
          AND earlier.rowid<=sync_queue.rowid
      ) WHERE entity_type IN ('health_record','care_task','care_execution','appointment','calendar_event','calendar_reminder');
      UPDATE sync_queue SET base_version = (
        SELECT count(*) FROM sync_queue earlier WHERE earlier.account_id=sync_queue.account_id
          AND earlier.entity_type=sync_queue.entity_type AND earlier.entity_id=sync_queue.entity_id
          AND earlier.rowid<sync_queue.rowid
      ) WHERE entity_type IN ('health_record','care_task','care_execution','appointment','calendar_event','calendar_reminder');
    `);
  },
};

export default migration;
