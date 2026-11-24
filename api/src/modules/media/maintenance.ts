import type { Queryable } from "../../db/queryable.js";
import type { Logger } from "../../observability/logger.js";
import type { MediaObjectStore } from "./objectStore.js";

type CleanupItem = { object_key: string; attempt_count: number };

export async function runMediaMaintenance(database: Queryable, store: MediaObjectStore, logger: Logger): Promise<void> {
  const due = await database.query<CleanupItem & import("pg").QueryResultRow>(
    "SELECT object_key,attempt_count FROM media_cleanup_queue WHERE next_retry_at<=now() ORDER BY created_at LIMIT 100");
  for (const item of due.rows) {
    try {
      await store.delete(item.object_key);
      await database.query("DELETE FROM media_cleanup_queue WHERE object_key=$1", [item.object_key]);
    } catch {
      await database.query("UPDATE media_cleanup_queue SET attempt_count=attempt_count+1,next_retry_at=now()+LEAST(interval '6 hours',interval '5 seconds'*power(2,LEAST(attempt_count,10))) WHERE object_key=$1", [item.object_key]);
      logger.error({ event: "media_cleanup_retry_scheduled" });
    }
  }

  let continuationToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const listed = await store.list("media/", continuationToken);
    for (const entry of listed.keys) {
      if (!entry.lastModified || Date.now() - entry.lastModified.getTime() < 24 * 60 * 60_000) continue;
      const referenced = await database.query("SELECT 1 FROM media_objects WHERE object_key=$1 UNION ALL SELECT 1 FROM media_cleanup_queue WHERE object_key=$1 LIMIT 1", [entry.key]);
      if (referenced.rows.length) continue;
      try { await store.delete(entry.key); }
      catch { logger.error({ event: "media_orphan_cleanup_failed" }); }
    }
    continuationToken = listed.continuationToken;
    if (!continuationToken) break;
  }
}
