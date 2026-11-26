import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { Logger } from "../../observability/logger.js";
import type { MediaObjectStore } from "../media/objectStore.js";

const BATCH_SIZE = 5;
const LEASE_MINUTES = 10;
const MAX_OBJECTS = 100_000;
const MEDIA_PREFIX = (userId: string) => `media/${userId}/`;

type ClaimedRequest = { request_id: string; user_id: string } & QueryResultRow;

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimRequests(pool: Pool): Promise<ClaimedRequest[]> {
  return transaction(pool, async (client) => {
    const claimed = await client.query<ClaimedRequest>(
      `WITH due AS (
         SELECT request_id
         FROM account_deletion_requests
         WHERE user_id IS NOT NULL
           AND status IN ('pending','processing')
           AND next_attempt_at <= now()
           AND (status='pending' OR processing_started_at IS NULL
             OR processing_started_at < now() - ($1::text || ' minutes')::interval)
         ORDER BY requested_at, request_id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE account_deletion_requests AS request
       SET status='processing', processing_started_at=now(),
           attempt_count=attempt_count+1, last_error_code=NULL
       FROM due
       WHERE request.request_id=due.request_id
       RETURNING request.request_id, request.user_id`,
      [LEASE_MINUTES, BATCH_SIZE],
    );
    return claimed.rows;
  });
}

async function deleteRemoteObjects(pool: Pool, store: MediaObjectStore | undefined, userId: string): Promise<void> {
  // We require LIST as well as DELETE: otherwise orphaned objects cannot be
  // proven absent and the deletion request must remain retryable.
  if (!store) throw Object.assign(new Error("Remote media storage is unavailable."), { code: "MEDIA_STORAGE_UNAVAILABLE" });
  const prefix = MEDIA_PREFIX(userId);
  const referenced = await pool.query<{ object_key: string } & QueryResultRow>(
    `SELECT object_key FROM media_objects WHERE owner_id=$1
     UNION SELECT object_key FROM media_cleanup_queue WHERE left(object_key,length($2))=$2`,
    [userId,prefix]);
  const keys = new Set<string>();
  for (const row of referenced.rows) {
    if (!row.object_key.startsWith(prefix)) throw Object.assign(new Error("Stored media key is outside the owner prefix."), { code: "MEDIA_STORAGE_INVALID_KEY" });
    keys.add(row.object_key);
  }
  let continuationToken: string | undefined;
  let visited = 0;
  do {
    const page = await store.list(prefix, continuationToken);
    for (const entry of page.keys) {
      if (!entry.key.startsWith(prefix)) throw Object.assign(new Error("Object storage returned a key outside the owner prefix."), { code: "MEDIA_STORAGE_INVALID_LIST" });
      visited += 1;
      if (visited > MAX_OBJECTS) throw Object.assign(new Error("Deletion exceeded the object safety limit."), { code: "MEDIA_OBJECT_LIMIT" });
      keys.add(entry.key);
    }
    continuationToken = page.continuationToken;
  } while (continuationToken);
  // Finish listing before deleting so page tokens cannot skip keys as the
  // object set shrinks. Repeating DELETE after a crash is safe and idempotent.
  for (const key of keys) await store.delete(key);
}

async function purgeOwnerRows(pool: Pool, requestId: string, userId: string): Promise<void> {
  await transaction(pool, async (client) => {
    const owner = await client.query<{ id: string; deleted_at: Date | null } & QueryResultRow>(
      "SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE", [userId]);

    if (owner.rows[0] && !owner.rows[0].deleted_at) {
      throw Object.assign(new Error("Account is not deactivated."), { code: "ACCOUNT_NOT_DEACTIVATED" });
    }

    const prefix = MEDIA_PREFIX(userId);
    await client.query("DELETE FROM media_cleanup_queue WHERE left(object_key,length($1))=$1", [prefix]);
    await client.query("DELETE FROM media_objects WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM health_attachments WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM calendar_reminders WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM reminders WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM care_task_executions WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM kirai_messages WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM kirai_conversations WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM ai_messages WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM ai_conversations WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM sync_changes WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM sync_operations WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM sync_cursors WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM sync_devices WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM auth_refresh_tokens token USING auth_sessions session WHERE token.session_id=session.id AND session.user_id=$1", [userId]);
    await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM calendar_events WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM appointments WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM care_tasks WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM health_records WHERE owner_id=$1", [userId]);
    await client.query("DELETE FROM pet_trackers WHERE pet_id IN (SELECT id FROM pets WHERE owner_id=$1)", [userId]);
    await client.query("DELETE FROM pets WHERE owner_id=$1", [userId]);

    // Keep only an unlinked operational receipt; the owner UUID and PII are
    // removed. The request ID remains suitable for support/audit correlation.
    await client.query(
      `UPDATE account_deletion_requests
       SET user_id=NULL,status='completed',completed_at=now(),processing_started_at=NULL,
           last_error_code=NULL
       WHERE request_id=$1 AND user_id=$2`, [requestId,userId]);
    if (owner.rows[0]) {
      const deleted = await client.query("DELETE FROM users WHERE id=$1", [userId]);
      if (deleted.rowCount !== 1) throw Object.assign(new Error("Account record was not deleted."), { code: "ACCOUNT_DELETE_INCOMPLETE" });
    }
  });
}

export function safeFailureCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : "ACCOUNT_DELETION_RETRY";
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "ACCOUNT_DELETION_RETRY";
}

async function deferRequest(pool: Pool, requestId: string, code: string): Promise<void> {
  await pool.query(
    `UPDATE account_deletion_requests
     SET status='pending',processing_started_at=NULL,last_error_code=$2,
         next_attempt_at=now()+LEAST(interval '6 hours',interval '5 seconds' * power(2,LEAST(attempt_count,10)))
     WHERE request_id=$1 AND status='processing'`, [requestId,code]);
}

/** Processes durable, owner-scoped deletion requests. A crashed lease is reclaimable. */
export async function runAccountDeletionBatch(
  pool: Pool,
  store: MediaObjectStore | undefined,
  logger: Logger,
): Promise<{ claimed: number; completed: number; deferred: number }> {
  const requests = await claimRequests(pool);
  let completed = 0;
  let deferred = 0;
  for (const request of requests) {
    try {
      await deleteRemoteObjects(pool, store, request.user_id);
      await purgeOwnerRows(pool, request.request_id, request.user_id);
      completed += 1;
      logger.info({ event: "account_deletion_completed", requestId: request.request_id });
    } catch (error) {
      const code = safeFailureCode(error);
      try {
        await deferRequest(pool, request.request_id, code);
        deferred += 1;
      } catch {
        // If this update also fails the lease expires and another worker can retry.
      }
      logger.error({ event: "account_deletion_deferred", requestId: request.request_id, code });
    }
  }
  return { claimed: requests.length, completed, deferred };
}
