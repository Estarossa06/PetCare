import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { advanceDomainQueueRevision } from "../src/features/sync/domainQueueState.ts";

test("offline domain edits advance local revisions and chain server versions behind queued operations",async()=>{
  const raw=new DatabaseSync(":memory:"),owner="00000000-0000-4000-8000-000000000001",id="00000000-0000-4000-8000-000000000002";
  raw.exec(`CREATE TABLE care_tasks(id TEXT PRIMARY KEY,owner_id TEXT,local_revision INTEGER NOT NULL DEFAULT 0,server_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sync_queue(operation_id TEXT,account_id TEXT,entity_type TEXT,entity_id TEXT,status TEXT);
    INSERT INTO care_tasks(id,owner_id) VALUES('${id}','${owner}');`);
  const db={
    getFirstAsync:async(sql,...args)=>raw.prepare(sql).get(...args),
    runAsync:async(sql,...args)=>raw.prepare(sql).run(...args),
  };
  try{
    const create=await advanceDomainQueueRevision(db,owner,"care_task",id,"create");
    assert.deepEqual(create,{baseVersion:0,localRevision:1});
    raw.prepare("INSERT INTO sync_queue VALUES('op1',?,'care_task',?,'pending')").run(owner,id);
    const edit1=await advanceDomainQueueRevision(db,owner,"care_task",id,"update");
    assert.deepEqual(edit1,{baseVersion:1,localRevision:2});
    raw.prepare("INSERT INTO sync_queue VALUES('op2',?,'care_task',?,'pending')").run(owner,id);
    raw.prepare("UPDATE care_tasks SET server_version=1 WHERE id=?").run(id);
    raw.prepare("DELETE FROM sync_queue WHERE operation_id='op1'").run();
    const edit2=await advanceDomainQueueRevision(db,owner,"care_task",id,"update");
    assert.deepEqual(edit2,{baseVersion:2,localRevision:3});
  }finally{raw.close();}
});
