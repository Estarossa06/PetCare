import type { Migration } from "./types.js";

const migration: Migration = {
  version: 7,
  name: "domain_sync_legacy_category_backfill",
  async up(client) {
    await client.query(`
      -- category did not exist in the original PostgreSQL schema. Preserve each
      -- legacy task's actual type while leaving tasks already synced by v1 intact.
      UPDATE care_tasks AS task SET category=task.task_type
      WHERE EXISTS (
        SELECT 1 FROM sync_changes AS baseline
        WHERE baseline.owner_id=task.owner_id AND baseline.entity_type='care_task'
          AND baseline.entity_id=task.id AND baseline.operation_id IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM sync_changes AS synced
        WHERE synced.owner_id=task.owner_id AND synced.entity_type='care_task'
          AND synced.entity_id=task.id AND synced.operation_id IS NOT NULL
      ) AND task.task_type IN ('feeding','walk','bath','hygiene','medication','vaccination','deworming','custom');
    `);
  },
};

export default migration;
