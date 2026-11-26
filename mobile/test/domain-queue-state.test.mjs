import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { advanceDomainQueueRevision, scheduleDomainRetry, selectReadyQueueOperations } from "../src/features/sync/domainQueueState.ts";

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

test("queue ordering holds children whose prerequisite is pending in another entity queue",()=>{
  const parent={operation_id:"parent",entity_type:"pet"}, child={operation_id:"child",entity_type:"health_record"}, independent={operation_id:"independent",entity_type:"appointment"};
  const edges=[{operation_id:"child",depends_on_operation_id:"parent"}];
  assert.deepEqual(selectReadyQueueOperations([child,independent],edges,50),[independent]);
  assert.deepEqual(selectReadyQueueOperations([child,parent],edges,50),[parent,child]);
});

test("domain retry is scoped to the local account even when operation IDs collide",async()=>{
  const raw=new DatabaseSync(":memory:"),now=Date.parse("2026-11-24T12:00:00.000Z");
  raw.exec("CREATE TABLE sync_queue(account_id TEXT,operation_id TEXT,status TEXT,attempt_count INTEGER,next_retry_at TEXT,last_error TEXT,updated_at TEXT,PRIMARY KEY(account_id,operation_id));");
  raw.prepare("INSERT INTO sync_queue VALUES(?,?,'in_flight',0,NULL,NULL,NULL)").run("account-a","same-op");
  raw.prepare("INSERT INTO sync_queue VALUES(?,?,'in_flight',0,NULL,NULL,NULL)").run("account-b","same-op");
  try{
    await scheduleDomainRetry({runAsync:async(sql,...args)=>raw.prepare(sql).run(...args)},"account-a","same-op",0,now);
    const rows=raw.prepare("SELECT account_id,status,attempt_count FROM sync_queue ORDER BY account_id").all();
    assert.deepEqual(rows.map(row=>({account_id:row.account_id,status:row.status,attempt_count:row.attempt_count})),[
      {account_id:"account-a",status:"pending",attempt_count:1},
      {account_id:"account-b",status:"in_flight",attempt_count:0},
    ]);
  }finally{raw.close();}
});
