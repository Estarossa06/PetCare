import type { getPetCareDatabase } from "../../db/database";
import { retryDelayMilliseconds } from "./petSyncPolicy.ts";

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

export interface QueueOperation {
  operation_id: string;
}

export interface QueueDependency {
  operation_id: string;
  depends_on_operation_id: string;
}

/** Selects only operations whose dependencies are present earlier in this batch. */
export function selectReadyQueueOperations<T extends QueueOperation>(
  candidates: T[],
  dependencies: QueueDependency[],
  limit: number,
): T[] {
  const dependenciesByOperation = new Map<string, string[]>();
  for (const edge of dependencies) {
    dependenciesByOperation.set(edge.operation_id, [
      ...(dependenciesByOperation.get(edge.operation_id) ?? []),
      edge.depends_on_operation_id,
    ]);
  }
  const selected = new Set<string>();
  const ready: T[] = [];
  let progressed = true;
  while (progressed && ready.length < limit) {
    progressed = false;
    for (const operation of candidates) {
      if (selected.has(operation.operation_id)) continue;
      const dependencies = dependenciesByOperation.get(operation.operation_id) ?? [];
      // A dependency edge remains until its operation is acknowledged. If its
      // parent is not in this batch, it is still pending in another entity
      // queue or is failed/conflicted; do not send the child prematurely.
      if (!dependencies.every((dependencyId) => selected.has(dependencyId))) continue;
      selected.add(operation.operation_id);
      ready.push(operation);
      progressed = true;
      if (ready.length >= limit) break;
    }
  }
  return ready;
}

export async function scheduleDomainRetry(
  db: { runAsync(source: string, ...params: (string | number | null)[]): Promise<unknown> },
  accountId: string,
  operationId: string,
  attemptCount: number,
  now = Date.now(),
): Promise<void> {
  const attempt = attemptCount + 1;
  await db.runAsync(
    `UPDATE sync_queue SET status='pending',attempt_count=?,next_retry_at=?,
       last_error='NETWORK_OR_SERVER_UNAVAILABLE',updated_at=?
     WHERE account_id=? AND operation_id=? AND status='in_flight'`,
    attempt,
    new Date(now + retryDelayMilliseconds(attempt)).toISOString(),
    new Date(now).toISOString(),
    accountId,
    operationId,
  );
}
