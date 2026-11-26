import type { SqliteExecutor } from "./migrations/types";

const ownerTables: ReadonlyArray<readonly [string, string]> = [
  ["sync_conflicts", "account_id"],
  ["sync_queue_dependencies", "account_id"],
  ["media_upload_queue", "account_id"],
  ["kirai_messages", "owner_id"],
  ["kirai_conversations", "owner_id"],
  ["health_attachments", "owner_id"],
  ["calendar_reminders", "owner_id"],
  ["reminders", "owner_id"],
  ["care_task_executions", "owner_id"],
  ["calendar_events", "owner_id"],
  ["appointments", "owner_id"],
  ["care_tasks", "owner_id"],
  ["health_records", "owner_id"],
  ["ai_messages", "owner_id"],
  ["ai_conversations", "owner_id"],
  ["sync_queue", "account_id"],
  ["pets", "owner_id"],
];

/** Deletes rows only from one already-resolved local account partition. */
export async function deleteLocalAccountRows(db: SqliteExecutor, accountId: string): Promise<void> {
  await db.runAsync(
    `DELETE FROM calendar_scheduled_notifications
     WHERE reminder_id IN (SELECT id FROM calendar_reminders WHERE owner_id=?)`, accountId);
  await db.runAsync(
    `DELETE FROM scheduled_notifications
     WHERE reminder_id IN (SELECT id FROM reminders WHERE owner_id=?)`, accountId);
  for (const [table, column] of ownerTables) {
    await db.runAsync(`DELETE FROM ${table} WHERE ${column}=?`, accountId);
  }
  await db.runAsync("DELETE FROM sync_metadata WHERE account_id=?", accountId);
}
