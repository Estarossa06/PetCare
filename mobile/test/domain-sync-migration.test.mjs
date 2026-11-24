import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import migration from "../src/db/migrations/0008_domain_sync_state.ts";

test("domain sync migration adds per-entity versions, appointment timezone, cursor and backfills outbox revisions", async () => {
  const db=new DatabaseSync(":memory:"), account="00000000-0000-4000-8000-000000000001",entity="00000000-0000-4000-8000-000000000002";
  db.exec(`CREATE TABLE sync_metadata(account_id TEXT PRIMARY KEY,last_download_cursor INTEGER NOT NULL DEFAULT 0,last_successful_sync_at TEXT,schema_version INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,auth_user_id TEXT,device_id TEXT);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE health_records(id TEXT PRIMARY KEY,owner_id TEXT); CREATE TABLE care_tasks(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE care_task_executions(id TEXT PRIMARY KEY,owner_id TEXT); CREATE TABLE calendar_events(id TEXT PRIMARY KEY,owner_id TEXT); CREATE TABLE calendar_reminders(id TEXT PRIMARY KEY,owner_id TEXT);
    CREATE TABLE sync_queue(operation_id TEXT,account_id TEXT,entity_type TEXT,entity_id TEXT,base_version INTEGER,local_revision INTEGER DEFAULT 0,status TEXT DEFAULT 'pending',last_error TEXT,updated_at TEXT);
    INSERT INTO sync_metadata(account_id,updated_at) VALUES('${account}','now');
    INSERT INTO sync_queue VALUES('op1','${account}','health_record','${entity}',0,0,'pending',NULL,'now'),('op2','${account}','health_record','${entity}',0,0,'pending',NULL,'now'),('file','${account}','health_attachment','${entity}',0,0,'pending',NULL,'now');`);
  try{
    await migration.up({execAsync:async(sql)=>db.exec(sql)});
    assert.equal(db.prepare("SELECT domain_download_cursor FROM sync_metadata WHERE account_id=?").get(account).domain_download_cursor,0);
    assert.ok(db.prepare("PRAGMA table_info(appointments)").all().some(c=>c.name==="timezone"));
    const rows=db.prepare("SELECT local_revision,base_version FROM sync_queue WHERE entity_type='health_record' ORDER BY rowid").all();
    assert.deepEqual(rows.map(r=>({...r})),[{local_revision:1,base_version:0},{local_revision:2,base_version:1}]);
    assert.deepEqual({...db.prepare("SELECT status,last_error FROM sync_queue WHERE operation_id='file'").get()},{status:"failed",last_error:"REMOTE_FILE_STORAGE_NOT_CONFIGURED"});
    for(const table of ["health_records","care_tasks","care_task_executions","appointments","calendar_events","calendar_reminders"]){
      const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
      assert.ok(columns.includes("server_version")&&columns.includes("local_revision")&&columns.includes("acknowledged_local_revision"),`${table} sync state missing`);
    }
  }finally{db.close();}
});
