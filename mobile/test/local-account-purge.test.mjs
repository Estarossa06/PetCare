import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { deleteLocalAccountRows } from "../src/db/localAccountPurge.ts";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";

test("local permanent account purge removes the selected partition and preserves other accounts", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE sync_metadata(account_id TEXT PRIMARY KEY,auth_user_id TEXT);
    CREATE TABLE pets(id TEXT PRIMARY KEY,owner_id TEXT,photo_storage_key TEXT);
    CREATE TABLE health_records(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE health_attachments(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE care_tasks(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE care_task_executions(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE reminders(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE scheduled_notifications(reminder_id TEXT PRIMARY KEY);
    CREATE TABLE calendar_events(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE calendar_reminders(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE calendar_scheduled_notifications(reminder_id TEXT PRIMARY KEY);
    CREATE TABLE ai_conversations(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE ai_messages(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE kirai_conversations(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE kirai_messages(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE sync_queue(operation_id TEXT PRIMARY KEY,account_id TEXT);
    CREATE TABLE sync_queue_dependencies(account_id TEXT,operation_id TEXT,depends_on_operation_id TEXT);
    CREATE TABLE sync_conflicts(id TEXT PRIMARY KEY,account_id TEXT);
    CREATE TABLE media_upload_queue(operation_id TEXT PRIMARY KEY,account_id TEXT);
    INSERT INTO sync_metadata VALUES('${A}','auth-a'),('${B}','auth-b');
    INSERT INTO pets VALUES('pet-a','${A}',NULL),('pet-b','${B}',NULL);
    INSERT INTO health_records VALUES('health-a','${A}'),('health-b','${B}');
    INSERT INTO health_attachments VALUES('attach-a','${A}'),('attach-b','${B}');
    INSERT INTO care_tasks VALUES('care-a','${A}'),('care-b','${B}');
    INSERT INTO care_task_executions VALUES('exec-a','${A}'),('exec-b','${B}');
    INSERT INTO appointments VALUES('appt-a','${A}'),('appt-b','${B}');
    INSERT INTO reminders VALUES('rem-a','${A}'),('rem-b','${B}');
    INSERT INTO scheduled_notifications VALUES('rem-a'),('rem-b');
    INSERT INTO calendar_events VALUES('event-a','${A}'),('event-b','${B}');
    INSERT INTO calendar_reminders VALUES('cal-rem-a','${A}'),('cal-rem-b','${B}');
    INSERT INTO calendar_scheduled_notifications VALUES('cal-rem-a'),('cal-rem-b');
    INSERT INTO ai_conversations VALUES('ai-conv-a','${A}'),('ai-conv-b','${B}');
    INSERT INTO ai_messages VALUES('ai-msg-a','${A}'),('ai-msg-b','${B}');
    INSERT INTO kirai_conversations VALUES('kirai-conv-a','${A}'),('kirai-conv-b','${B}');
    INSERT INTO kirai_messages VALUES('kirai-msg-a','${A}'),('kirai-msg-b','${B}');
    INSERT INTO sync_queue VALUES('op-a','${A}'),('op-b','${B}');
    INSERT INTO sync_queue_dependencies VALUES('${A}','op-a','op-a'),('${B}','op-b','op-b');
    INSERT INTO sync_conflicts VALUES('conflict-a','${A}'),('conflict-b','${B}');
    INSERT INTO media_upload_queue VALUES('media-op-a','${A}'),('media-op-b','${B}');`);

  await deleteLocalAccountRows({ runAsync: async (sql, ...params) => db.prepare(sql).run(...params) }, A);
  for (const table of ["sync_conflicts","sync_queue_dependencies","media_upload_queue","kirai_messages","kirai_conversations","health_attachments","calendar_reminders","reminders","care_task_executions","calendar_events","appointments","care_tasks","health_records","ai_messages","ai_conversations","sync_queue","pets","sync_metadata"]) {
    assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 1, `${table} should retain only account B's row`);
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM pets WHERE owner_id=?").get(B).count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM calendar_scheduled_notifications WHERE reminder_id='cal-rem-a'").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM scheduled_notifications WHERE reminder_id='rem-a'").get().count, 0);
  db.close();
});
