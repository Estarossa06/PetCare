import * as Crypto from "expo-crypto";
import { getPetCareDatabase } from "../../db/database";
import { getActiveLocalAuthUserId, getLocalAccountId, withLocalWriteTransaction } from "../../db/localAccount";
import { apiClient } from "../auth/apiClient";
import { scheduleDomainRetry, selectReadyQueueOperations } from "./domainQueueState";
import { calendarRepository } from "../calendar/calendarRepository";
import { refreshTarget } from "../calendar/calendarService";
import { syncCalendarNotification } from "../calendar/calendarNotifications";

const entities = ["health_record", "care_task", "care_execution", "appointment", "calendar_event", "calendar_reminder"] as const;
type Entity = typeof entities[number];
type Queue = { operation_id: string; entity_type: Entity; entity_id: string; action: "create"|"update"|"delete"; payload: string; base_version: number; local_revision: number; changed_fields: string; attempt_count: number };
type Result = { operation_id: string; entity_type: Entity; entity_id: string; status: "applied"|"already_applied"|"conflict"|"rejected"|"dependency_blocked"; server_version?: number; cursor?: string; server_snapshot?: Record<string, unknown>; code?: string };
type Change = Record<string, unknown> & { id: string; entity_type: Entity; entity_version: number; change_type: "upsert"|"delete"; cursor: string; owner_id: string };
const tableFor: Record<Entity,string> = { health_record:"health_records",care_task:"care_tasks",care_execution:"care_task_executions",appointment:"appointments",calendar_event:"calendar_events",calendar_reminder:"calendar_reminders" };
const fieldsFor: Record<Entity,string[]> = {
  health_record:["pet_id","record_type","record_subtype","title","description","occurred_at","professional_name","clinic_name","observations","details","next_event_at"],
  care_task:["pet_id","task_type","category","title","description","observations","notes","recurrence_rule","schedule","timezone","starts_at","next_run_at","ends_at","enabled"],
  care_execution:["task_id","pet_id","scheduled_for","executed_at","status","notes"],
  appointment:["pet_id","title","starts_at","ends_at","location","notes","status","timezone"],
  calendar_event:["pet_id","title","description","category","starts_at","ends_at","timezone","status","observations"],
  calendar_reminder:["pet_id","calendar_event_id","care_task_id","appointment_id","health_record_id","title","remind_at","lead_minutes","timezone","status","enabled","notes"],
};
const localColumns: Record<Entity,Record<string,string>> = {
  health_record:{details:"details_json"}, care_task:{schedule:"schedule_json"}, care_execution:{}, appointment:{}, calendar_event:{}, calendar_reminder:{enabled:"enabled"},
};
function assertAccount(authId:string,accountId:string){if(getActiveLocalAuthUserId()!==authId)throw new Error("Active account changed during domain synchronization.");void accountId;}
function jsonValue(v:unknown):string { return typeof v === "string" ? v : JSON.stringify(v); }
function cursorValue(cursor:string):number{const n=Number(cursor);if(!/^(0|[1-9]\d*)$/.test(cursor)||!Number.isSafeInteger(n)||n<0)throw new Error("The domain sync cursor is outside SQLite's safe integer range.");return n;}
function localValue(entity:Entity,key:string,value:unknown):unknown {
  if(value===undefined) return null;
  if(key==="enabled") return value ? 1 : 0;
  if(key==="details"||key==="schedule") return jsonValue(value);
  if(value && typeof value==="object" && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}
function syncPayload(entity:Entity,raw:string):Record<string,unknown>{
  const value=JSON.parse(raw) as Record<string,unknown>, allowed=new Set([...fieldsFor[entity],"id","owner_id","created_at","updated_at","deleted_at"]);
  return Object.fromEntries(Object.entries(value).filter(([key])=>allowed.has(key)));
}

async function pending(localId:string):Promise<Array<Queue & {depends_on:string[]}>> {
  const db=await getPetCareDatabase(), now=new Date().toISOString();
  const rows=await db.getAllAsync<Queue>(`SELECT operation_id,entity_type,entity_id,action,payload,base_version,local_revision,changed_fields,attempt_count FROM sync_queue WHERE account_id=? AND entity_type IN ('health_record','care_task','care_execution','appointment','calendar_event','calendar_reminder') AND status='pending' AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY created_at,rowid LIMIT 500`,localId,now);
  const edges=await db.getAllAsync<{operation_id:string;depends_on_operation_id:string}>("SELECT operation_id,depends_on_operation_id FROM sync_queue_dependencies WHERE account_id=?",localId);
  const ready=selectReadyQueueOperations(rows,edges,50);
  const by=new Map<string,string[]>();
  for(const edge of edges)by.set(edge.operation_id,[...(by.get(edge.operation_id)??[]),edge.depends_on_operation_id]);
  return ready.map(row=>({...row,depends_on:by.get(row.operation_id)??[]}));
}

async function applyResults(authId:string,localId:string,results:Result[]):Promise<void>{
  await withLocalWriteTransaction(async(tx,owner)=>{
    assertAccount(authId,localId);if(owner!==localId)throw new Error("Local account changed during domain sync.");
    for(const r of results){
      const table=tableFor[r.entity_type];
      if(r.status==="applied"||r.status==="already_applied"){
        if(!Number.isSafeInteger(r.server_version)||!r.cursor)throw new Error("Incomplete domain sync acknowledgement.");
        const queued=await tx.getFirstAsync<{local_revision:number}>("SELECT local_revision FROM sync_queue WHERE account_id=? AND operation_id=?",owner,r.operation_id);if(!queued)continue;
        await tx.runAsync(`UPDATE ${table} SET version=?,server_version=?,acknowledged_local_revision=max(acknowledged_local_revision,?) WHERE owner_id=? AND id=?`,r.server_version!,r.server_version!,queued.local_revision,owner,r.entity_id);
        await tx.runAsync("DELETE FROM sync_queue_dependencies WHERE account_id=? AND depends_on_operation_id=?",owner,r.operation_id);
        await tx.runAsync("DELETE FROM sync_queue WHERE account_id=? AND operation_id=?",owner,r.operation_id);
        await tx.runAsync(`UPDATE sync_queue SET status='pending',next_retry_at=NULL,updated_at=? WHERE account_id=? AND status='blocked' AND NOT EXISTS(SELECT 1 FROM sync_queue_dependencies d WHERE d.account_id=sync_queue.account_id AND d.operation_id=sync_queue.operation_id)`,new Date().toISOString(),owner);
      } else if(r.status==="conflict"&&r.server_snapshot){
        const q=await tx.getFirstAsync<{base_version:number;changed_fields:string;payload:string}>("SELECT base_version,changed_fields,payload FROM sync_queue WHERE account_id=? AND operation_id=?",owner,r.operation_id);
        const local=await tx.getFirstAsync<Record<string,unknown>>(`SELECT * FROM ${table} WHERE owner_id=? AND id=?`,owner,r.entity_id);
        if(q&&local&&Number.isSafeInteger(r.server_version)){
          await tx.runAsync("UPDATE sync_queue SET status='conflict',last_error=?,updated_at=? WHERE account_id=? AND operation_id=?",r.code??"VERSION_CONFLICT",new Date().toISOString(),owner,r.operation_id);
          await tx.runAsync(`INSERT INTO sync_conflicts(id,account_id,operation_id,entity_type,entity_id,base_version,server_version,local_snapshot,server_snapshot,conflicting_fields,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,operation_id) DO UPDATE SET server_version=excluded.server_version,server_snapshot=excluded.server_snapshot`,Crypto.randomUUID().toLowerCase(),owner,r.operation_id,r.entity_type,r.entity_id,q.base_version,r.server_version!,JSON.stringify(local),JSON.stringify(r.server_snapshot),q.changed_fields,new Date().toISOString());
        }
      } else await tx.runAsync("UPDATE sync_queue SET status=?,last_error=?,updated_at=? WHERE account_id=? AND operation_id=?",r.status==="dependency_blocked"?"blocked":"failed",r.code??r.status,new Date().toISOString(),owner,r.operation_id);
    }
  });
}

async function applyChanges(authId:string,localId:string,changes:Change[],cursor:string):Promise<void>{
  await withLocalWriteTransaction(async(tx,owner)=>{
    assertAccount(authId,localId);if(owner!==localId)throw new Error("Local account changed during domain pull.");
    for(const c of changes){
      if(!entities.includes(c.entity_type))throw new Error("Unsupported entity in domain pull.");
      const table=tableFor[c.entity_type], mapping=localColumns[c.entity_type];
      const existing=await tx.getFirstAsync<Record<string,unknown>&{owner_id:string;server_version:number}>(`SELECT * FROM ${table} WHERE id=?`,c.id);
      if(existing&&existing.owner_id!==owner)throw new Error("A remote entity id collides with another local account; transaction rolled back.");
      const pendingRow=await tx.getFirstAsync<{operation_id:string;base_version:number;changed_fields:string}>(`SELECT operation_id,base_version,changed_fields FROM sync_queue WHERE account_id=? AND entity_type=? AND entity_id=? AND status IN ('pending','in_flight','blocked','conflict','failed') ORDER BY rowid LIMIT 1`,owner,c.entity_type,c.id);
      if(existing&&c.entity_version<=existing.server_version)continue;
      if(existing&&pendingRow){
        await tx.runAsync("UPDATE sync_queue SET status='conflict',last_error='REMOTE_CHANGE',updated_at=? WHERE account_id=? AND operation_id=?",new Date().toISOString(),owner,pendingRow.operation_id);
        await tx.runAsync(`INSERT INTO sync_conflicts(id,account_id,operation_id,entity_type,entity_id,base_version,server_version,local_snapshot,server_snapshot,conflicting_fields,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,operation_id) DO UPDATE SET server_version=excluded.server_version,server_snapshot=excluded.server_snapshot`,Crypto.randomUUID().toLowerCase(),owner,pendingRow.operation_id,c.entity_type,c.id,pendingRow.base_version,c.entity_version,JSON.stringify(existing),JSON.stringify(c),pendingRow.changed_fields,new Date().toISOString());
        continue;
      }
      const row:Record<string,unknown>={id:c.id,owner_id:owner,version:c.entity_version,server_version:c.entity_version,local_revision:existing?.local_revision??0,acknowledged_local_revision:existing?.local_revision??0,created_at:c.created_at,updated_at:c.updated_at,deleted_at:c.deleted_at};
      for(const key of fieldsFor[c.entity_type]) row[mapping[key]??key]=localValue(c.entity_type,key,c[key]);
      const cols=Object.keys(row), vals=Object.values(row), updates=cols.filter(k=>!['id','owner_id','local_revision'].includes(k)).map(k=>`${k}=excluded.${k}`).join(',');
      await tx.runAsync(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${updates}`,...vals as never[]);
      if(c.entity_type==="calendar_reminder") await tx.runAsync("INSERT OR IGNORE INTO calendar_scheduled_notifications(reminder_id,scheduled_version,scheduled_for,scheduling_status,updated_at) VALUES(?,0,NULL,'pending',?)",c.id,new Date().toISOString());
    }
    await tx.runAsync("UPDATE sync_metadata SET domain_download_cursor=?,last_successful_sync_at=?,updated_at=? WHERE account_id=?",cursorValue(cursor),new Date().toISOString(),new Date().toISOString(),owner);
  });
  for(const c of changes){
    try{
      if(c.entity_type==="calendar_reminder"){
        const reminder=await calendarRepository.getReminder(c.id);
        if(reminder)await syncCalendarNotification(reminder,false);
      }else if(c.entity_type==="calendar_event")await refreshTarget({kind:"calendar_event",id:c.id});
      else if(c.entity_type==="care_task")await refreshTarget({kind:"care_task",id:c.id});
      else if(c.entity_type==="appointment")await refreshTarget({kind:"appointment",id:c.id});
      else if(c.entity_type==="health_record")await refreshTarget({kind:"health_record",id:c.id});
    }catch{/* Device notification scheduling is local and must not roll back committed domain data. */}
  }
}

export async function synchronizeDomainEntities(deviceId:string,authId:string,localId:string):Promise<void>{
  assertAccount(authId,localId);const db=await getPetCareDatabase(), ops=await pending(localId);
  if(ops.length){await db.execAsync("BEGIN IMMEDIATE");try{for(const op of ops)await db.runAsync("UPDATE sync_queue SET status='in_flight',updated_at=? WHERE account_id=? AND operation_id=? AND status='pending'",new Date().toISOString(),localId,op.operation_id);await db.execAsync("COMMIT");}catch(e){await db.execAsync("ROLLBACK");throw e;}
    try{
      const response=await apiClient.request<{results:Result[]}>('/sync/v1/domain/push',{method:'POST',authenticated:true,body:{protocol_version:1,device_id:deviceId,batch_id:Crypto.randomUUID().toLowerCase(),operations:ops.map(o=>({operation_id:o.operation_id,entity_type:o.entity_type,entity_id:o.entity_id,action:o.action,base_version:o.base_version,local_revision:o.local_revision,depends_on:o.depends_on,changed_fields:JSON.parse(o.changed_fields),payload:syncPayload(o.entity_type,o.payload)}))}});
      await applyResults(authId,localId,response.results);const seen=new Set(response.results.map(r=>r.operation_id));for(const o of ops)if(!seen.has(o.operation_id))await retry(o,localId);
    }catch(e){for(const o of ops)await retry(o,localId);throw e;}
  }
  const cursorRow=await db.getFirstAsync<{domain_download_cursor:number}>('SELECT domain_download_cursor FROM sync_metadata WHERE account_id=?',localId);let cursor=cursorRow?.domain_download_cursor??0;
  for(let i=0;i<100;i++){
    assertAccount(authId,localId);
    const page=await apiClient.request<{changes:Change[];next_cursor:string;has_more:boolean}>('/sync/v1/domain/pull',{method:'POST',authenticated:true,body:{device_id:deviceId,after_cursor:String(cursor),limit:200}});
    await applyChanges(authId,localId,page.changes,page.next_cursor);cursor=cursorValue(page.next_cursor);if(!page.has_more)break;
  }
  const saved=await db.getFirstAsync<{domain_download_cursor:number}>('SELECT domain_download_cursor FROM sync_metadata WHERE account_id=?',localId);
  await apiClient.request('/sync/v1/ack',{method:'POST',authenticated:true,body:{device_id:deviceId,cursor:String(saved?.domain_download_cursor??0)}});
}

async function retry(op:Queue,accountId:string):Promise<void>{const db=await getPetCareDatabase();await scheduleDomainRetry(db,accountId,op.operation_id,op.attempt_count);}
