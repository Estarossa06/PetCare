import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { recoverInterruptedSync } from "../src/db/recoverSync.ts";

test("reopening local storage makes in-flight pet, domain and media operations eligible for retry", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`CREATE TABLE sync_queue (entity_type TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE media_upload_queue (status TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO sync_queue VALUES
        ('pet','in_flight','before-restart'),
        ('health_record','in_flight','medical-before-restart'),
        ('calendar_reminder','in_flight','reminder-before-restart'),
        ('care_task','pending','unchanged');
      INSERT INTO media_upload_queue VALUES('in_flight','media-before-restart'),('failed','preserve-failure');`);
    await recoverInterruptedSync({
      runAsync: async (sql, ...parameters) => database.prepare(sql).run(...parameters),
    });
    assert.equal(database.prepare("SELECT count(*) AS count FROM sync_queue WHERE status='pending'").get().count, 4);
    assert.equal(database.prepare("SELECT count(*) AS count FROM sync_queue WHERE status = 'in_flight'").get().count, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM media_upload_queue WHERE status='pending'").get().count, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM media_upload_queue WHERE status='in_flight'").get().count, 0);
  } finally {
    database.close();
  }
});
