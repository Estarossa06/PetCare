import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { assertMigrationsApplied } from "./assertMigrations.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import type { Logger } from "../src/observability/logger.js";

const url=process.env.PETCARE_TEST_DATABASE_URL;
const enabled=Boolean(url)&&process.env.PETCARE_RUN_AUTH_DB_TESTS==="1";
const secret=Buffer.from("domain-sync-test-secret-is-at-least-32-bytes");
const logger:Logger={info:()=>{},error:()=>{}};
const password="domain sync integration password";
type Auth={accessToken:string;user:{id:string}};
type Op={operation_id:string;entity_type:string;entity_id:string;action:"create"|"update"|"delete";base_version:number;local_revision:number;depends_on:string[];changed_fields:string[];payload:Record<string,unknown>};

test("PostgreSQL domain sync persists all requested entities with owner isolation, optimistic versions, tombstones and pull",{skip:!enabled&&"Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for petcare_test."},async()=>{
  const parsed=new URL(url!);assert.ok(["postgres:","postgresql:"].includes(parsed.protocol));assert.equal(decodeURIComponent(parsed.pathname.slice(1)),"petcare_test");
  const pool=createDatabasePool(url!), run=randomUUID(), emails=[`domain-${run}-a@test.invalid`,`domain-${run}-b@test.invalid`];let server:Server|undefined,started=false;
  try{
    assert.equal((await pool.query<{name:string}>("SELECT current_database() AS name")).rows[0].name,"petcare_test");
    await assertMigrationsApplied(pool,["domain_sync_entities"]);
    server=createServer(createApp({config:{corsOrigins:[],accessTokenSecret:secret},database:pool,authStore:new PostgresAuthStore(pool),logger}));server.listen(0,"127.0.0.1");await once(server,"listening");
    const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;started=true;
    const a=await register(base,emails[0]),b=await register(base,emails[1]),deviceA=randomUUID(),deviceB=randomUUID();
    assert.equal((await put(base,`/sync/v1/devices/${deviceA}`,{platform:"web",schema_version:8},a.accessToken)).status,200);
    assert.equal((await put(base,`/sync/v1/devices/${deviceB}`,{platform:"ios",schema_version:8},b.accessToken)).status,200);
    const pet=(await post(base,"/pets",{name:"Mora",species:"cat"},a.accessToken));assert.equal(pet.status,201);const petId=(await body<{pet:{id:string}}>(pet)).pet.id;
    const now=new Date().toISOString(), ids=Object.fromEntries(["health_record","care_task","care_execution","appointment","calendar_event","calendar_reminder"].map(k=>[k,randomUUID()]));
    const records:Record<string,Record<string,unknown>>={
      health_record:{id:ids.health_record,owner_id:b.user.id,pet_id:petId,record_type:"vaccination",record_subtype:null,title:"Rabies",description:"annual",occurred_at:now,professional_name:"Dr. A",clinic_name:"Vet",observations:"fine",details:{vaccineName:"R1",dose:"1ml"},next_event_at:null,created_at:now,updated_at:now,deleted_at:null},
      care_task:{id:ids.care_task,owner_id:a.user.id,pet_id:petId,task_type:"feeding",category:"feeding",title:"Dinner",description:"wet food",observations:"",notes:"",recurrence_rule:'{"frequency":"daily","interval":1,"unit":"days"}',schedule:{frequency:"daily",interval:1,unit:"days"},timezone:"America/Bogota",starts_at:now,next_run_at:now,ends_at:null,enabled:1,created_at:now,updated_at:now,deleted_at:null},
      care_execution:{id:ids.care_execution,owner_id:a.user.id,task_id:ids.care_task,pet_id:petId,scheduled_for:now,executed_at:now,status:"completed",notes:"done",created_at:now,updated_at:now,deleted_at:null},
      appointment:{id:ids.appointment,owner_id:a.user.id,pet_id:petId,title:"Checkup",starts_at:now,ends_at:null,location:"Clinic",notes:"",status:"scheduled",timezone:"UTC",created_at:now,updated_at:now,deleted_at:null},
      calendar_event:{id:ids.calendar_event,owner_id:a.user.id,pet_id:petId,title:"Birthday",description:"",category:"birthday",starts_at:now,ends_at:null,timezone:"America/Bogota",status:"scheduled",observations:"",created_at:now,updated_at:now,deleted_at:null},
      calendar_reminder:{id:ids.calendar_reminder,owner_id:a.user.id,pet_id:petId,calendar_event_id:ids.calendar_event,care_task_id:null,appointment_id:null,health_record_id:null,title:"Birthday reminder",remind_at:now,lead_minutes:30,timezone:"America/Bogota",status:"pending",enabled:1,notes:"",created_at:now,updated_at:now,deleted_at:null},
    };
    const order=["health_record","care_task","care_execution","appointment","calendar_event","calendar_reminder"] as const;
    const operations:Op[]=order.map((entity_type,i)=>({operation_id:randomUUID(),entity_type,entity_id:String(ids[entity_type as keyof typeof ids]),action:"create",base_version:0,local_revision:1,depends_on:i===2?[String(ids.care_task)]:[],changed_fields:Object.keys(records[entity_type]),payload:records[entity_type]}));
    // Dependencies are operation IDs, not entity IDs: make the execution depend on the task creation receipt.
    operations[2].depends_on=[operations[1].operation_id];operations[5].depends_on=[operations[4].operation_id];
    const push=async(token:string,device:string,ops:Op[])=>{const r=await post(base,"/sync/v1/domain/push",{protocol_version:1,device_id:device,batch_id:randomUUID(),operations:ops},token);if(!r.ok)throw new Error(`${ops[0]?.entity_type??"batch"} push HTTP ${r.status}: ${await r.text()}`);return r.json() as Promise<{results:Array<{operation_id:string;status:string;server_version?:number;cursor?:string;code?:string}>}>;};
    const created=[] as Awaited<ReturnType<typeof push>>[];
    for(let i=0;i<operations.length;i++){const result=await push(a.accessToken,deviceA,[operations[i]]);assert.equal(result.results[0].status,"applied",`${order[i]} create failed: ${result.results[0].code??result.results[0].status}`);created.push(result);}
    assert.equal((await pool.query<{owner_id:string}>("SELECT owner_id FROM health_records WHERE id=$1",[ids.health_record])).rows[0].owner_id,a.user.id,"owner_id in payload must be ignored");
    const replay=await push(a.accessToken,deviceA,[operations[0]]);assert.equal(replay.results[0].status,"applied");
    assert.equal(Number((await pool.query<{n:string}>("SELECT count(*)::text n FROM health_records WHERE owner_id=$1 AND id=$2",[a.user.id,ids.health_record])).rows[0].n),1);

    const missingDependency=randomUUID(),retryId=randomUUID(),retryEventId=randomUUID(),retryTime=new Date().toISOString();
    const dependencyRetry:Op={...operations[4],operation_id:retryId,entity_id:retryEventId,base_version:0,local_revision:1,depends_on:[missingDependency],payload:{...records.calendar_event,id:retryEventId,title:"Dependency retry",created_at:retryTime,updated_at:retryTime}};
    assert.equal((await push(a.accessToken,deviceA,[dependencyRetry])).results[0].status,"dependency_blocked");
    const prerequisite:Op={...operations[3],operation_id:missingDependency,entity_id:randomUUID(),base_version:0,local_revision:1,depends_on:[],payload:{...records.appointment,id:randomUUID(),created_at:retryTime,updated_at:retryTime}};
    prerequisite.payload={...prerequisite.payload,id:prerequisite.entity_id};
    assert.equal((await push(a.accessToken,deviceA,[prerequisite])).results[0].status,"applied");
    assert.equal((await push(a.accessToken,deviceA,[dependencyRetry])).results[0].status,"applied");

    const updated={
      health_record:{...records.health_record,title:"Rabies booster"},
      care_task:{...records.care_task,title:"Dinner updated"},
      care_execution:{...records.care_execution,notes:"confirmed"},
      appointment:{...records.appointment,title:"Checkup updated"},
      calendar_event:{...records.calendar_event,title:"Birthday updated"},
      calendar_reminder:{...records.calendar_reminder,status:"attended",enabled:0},
    };
    const updateOps:Op[]=[];
    for(let i=0;i<order.length;i++){
      const entity=order[i],op:Op={...operations[i],operation_id:randomUUID(),action:"update",base_version:1,local_revision:2,depends_on:[operations[i].operation_id],changed_fields:Object.keys(updated[entity]),payload:{...updated[entity],updated_at:new Date().toISOString()}};
      const result=(await push(a.accessToken,deviceA,[op])).results[0];assert.equal(result.status,"applied",`${entity} update failed`);assert.equal(result.server_version,2);updateOps.push(op);
    }
    const updatedPayload={...updated.health_record,title:"Rabies booster",updated_at:new Date().toISOString()};
    const update=updateOps[0];
    const stale:Op={...update,operation_id:randomUUID(),base_version:1,local_revision:3,payload:{...updatedPayload,title:"stale"}};
    assert.equal((await push(a.accessToken,deviceA,[stale])).results[0].status,"conflict");
    for(const entity of ["calendar_reminder","care_execution","care_task","appointment","health_record","calendar_event"]){
      const i=order.indexOf(entity),deletedAt=new Date().toISOString(),op:Op={...updateOps[i],operation_id:randomUUID(),action:"delete",base_version:2,local_revision:3,depends_on:[updateOps[i].operation_id],changed_fields:["deleted_at"],payload:{...updated[entity],deleted_at:deletedAt,updated_at:deletedAt}};
      assert.equal((await push(a.accessToken,deviceA,[op])).results[0].status,"applied",`${entity} delete failed`);
    }
    const pullA=await body<{changes:Array<Record<string,unknown>&{entity_type:string;id:string;title:string}>;next_cursor:string;has_more:boolean}>(await post(base,"/sync/v1/domain/pull",{device_id:deviceA,after_cursor:"0",limit:100},a.accessToken));
    for(const type of order)assert.ok(pullA.changes.some(x=>x.entity_type===type),`missing ${type} in domain pull`);
    assert.equal(pullA.changes.find(x=>x.entity_type==="health_record"&&x.id===ids.health_record)?.title,"Rabies booster");
    for(const entity of order)assert.ok(pullA.changes.some(x=>x.entity_type===entity&&x.id===ids[entity as keyof typeof ids]&&x.deleted_at),`${entity} tombstone missing`);
    assert.equal((await post(base,"/sync/v1/ack",{device_id:deviceA,cursor:pullA.next_cursor},a.accessToken)).status,200);
    const pullB=await body<{changes:unknown[]}>(await post(base,"/sync/v1/domain/pull",{device_id:deviceB,after_cursor:"0"},b.accessToken));assert.deepEqual(pullB.changes,[]);
    const badRelationId=randomUUID();const badRelation:Op={...operations[0],operation_id:randomUUID(),entity_type:"care_task",entity_id:badRelationId,action:"create",base_version:0,local_revision:1,depends_on:[],payload:{...records.care_task,id:badRelationId,pet_id:randomUUID()}};
    assert.equal((await push(a.accessToken,deviceA,[badRelation])).results[0].status,"rejected");
  }finally{
    if(server){const closed=once(server,"close");server.close();await closed;}
    if(started){const users=await pool.query<{id:string}>("SELECT id FROM users WHERE email=ANY($1::text[])",[emails]),ids=users.rows.map(r=>r.id);
      for(const table of ["calendar_reminders","care_task_executions","calendar_events","health_records","care_tasks","appointments"])await pool.query(`DELETE FROM ${table} WHERE owner_id=ANY($1::uuid[])`,[ids]);
      await pool.query("DELETE FROM sync_changes WHERE owner_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM sync_operations WHERE user_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM sync_devices WHERE user_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM sync_cursors WHERE owner_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM pets WHERE owner_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM auth_refresh_tokens t USING auth_sessions s WHERE t.session_id=s.id AND s.user_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[ids]);
      const residue=await pool.query<{n:string}>("SELECT count(*)::text n FROM users WHERE email=ANY($1::text[])",[emails]);assert.equal(Number(residue.rows[0].n),0,`fixture cleanup failed (${run})`);
    }
    await pool.end();
  }
});

async function register(base:string,email:string):Promise<Auth>{const r=await post(base,"/auth/register",{email,password,name:"Domain sync test"});assert.equal(r.status,201);return body<Auth>(r);}
async function post(base:string,path:string,data:unknown,token?:string):Promise<Response>{return fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});}
async function put(base:string,path:string,data:unknown,token:string):Promise<Response>{return fetch(base+path,{method:"PUT",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(data)});}
async function body<T>(r:Response):Promise<T>{if(!r.ok){const error=await r.text();throw new Error(`Unexpected HTTP ${r.status}: ${error}`);}return r.json() as Promise<T>;}
