import type { SqliteExecutor } from "./migrations/types";

export async function recoverInterruptedSync(db: SqliteExecutor): Promise<void> {
  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'pending', updated_at = ?
     WHERE status = 'in_flight'`,
    new Date().toISOString(),
  );
  await db.runAsync(
    `UPDATE media_upload_queue
     SET status='pending',updated_at=?
     WHERE status='in_flight'`,
    new Date().toISOString(),
  );
}
