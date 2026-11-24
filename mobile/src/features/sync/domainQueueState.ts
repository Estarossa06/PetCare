import type { getPetCareDatabase } from "../../db/database";

const tables: Record<string, string> = {
  health_record: "health_records", care_task: "care_tasks", care_execution: "care_task_executions",
  appointment: "appointments", calendar_event: "calendar_events", calendar_reminder: "calendar_reminders",
};

export async function advanceDomainQueueRevision(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  entityType: string,
  entityId: string,
  action: "create" | "update" | "delete",
): Promise<{ baseVersion: number; localRevision: number }> {
  const table = tables[entityType];
  if (!table) throw new Error(`Unsupported locally queued sync entity: ${entityType}`);
  const row = await tx.getFirstAsync<{ local_revision: number; server_version: number }>(
    `UPDATE ${table} SET local_revision=local_revision+1 WHERE owner_id=? AND id=? RETURNING local_revision,server_version`,
    ownerId, entityId,
  );
  if (!row) throw new Error("The local sync entity disappeared before its outbox operation was recorded.");
  const queued = await tx.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM sync_queue WHERE account_id=? AND entity_type=? AND entity_id=?
     AND status IN ('pending','in_flight','blocked','conflict','failed')`, ownerId, entityType, entityId,
  );
  const baseVersion = action === "create" ? 0 : row.server_version + (queued?.count ?? 0);
  return { baseVersion, localRevision: row.local_revision };
}
