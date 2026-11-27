import { createHash } from "node:crypto";
import { Router } from "express";
import type { QueryResultRow } from "pg";
import { createAuthenticateMiddleware, requirePrincipal } from "../auth/middleware/authenticate.js";
import type { AuthStore } from "../auth/types.js";
import type { SyncPool, SyncQueryable } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const specs = {
  health_record: { table: "health_records", fields: ["pet_id","record_type","record_subtype","title","description","occurred_at","professional_name","clinic_name","observations","details","next_event_at"] },
  care_task: { table: "care_tasks", fields: ["pet_id","task_type","category","title","description","observations","notes","recurrence_rule","schedule","timezone","starts_at","next_run_at","ends_at","enabled"] },
  care_execution: { table: "care_task_executions", fields: ["task_id","pet_id","scheduled_for","executed_at","status","notes"] },
  appointment: { table: "appointments", fields: ["pet_id","title","starts_at","ends_at","location","notes","status","timezone"] },
  calendar_event: { table: "calendar_events", fields: ["pet_id","title","description","category","starts_at","ends_at","timezone","status","observations"] },
  calendar_reminder: { table: "calendar_reminders", fields: ["pet_id","calendar_event_id","care_task_id","appointment_id","health_record_id","title","remind_at","lead_minutes","timezone","status","enabled","notes"] },
} as const;
const requiredOnCreate: Record<keyof typeof specs, string[]> = {
  health_record:["pet_id","record_type","title","occurred_at"],
  care_task:["pet_id","task_type","title","timezone","starts_at"],
  care_execution:["task_id","pet_id","scheduled_for","status"],
  appointment:["pet_id","title","starts_at"],
  calendar_event:["title","category","starts_at","timezone"],
  calendar_reminder:["title","remind_at","timezone"],
};
type Entity = keyof typeof specs;
type Db = SyncQueryable & Partial<SyncPool>;

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID");
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("INVALID");
  return value.toLowerCase();
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const x = value as Record<string, unknown>;
  return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}`;
}
function dateFields(payload: Record<string, unknown>, action: string): void {
  for (const field of ["occurred_at","next_event_at","starts_at","next_run_at","ends_at","scheduled_for","executed_at","remind_at","created_at","updated_at","deleted_at"]) {
    const value = payload[field];
    if (value === null && ["next_event_at","next_run_at","ends_at","executed_at","deleted_at"].includes(field)) continue;
    if (value === undefined) continue;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString()!==value) throw new Error("INVALID");
  }
  if (action === "delete" && !payload.deleted_at) throw new Error("INVALID");
  if (action !== "delete" && payload.deleted_at) throw new Error("INVALID");
}
function pool(db: Db): SyncPool | null { return typeof db.connect === "function" ? db as SyncPool : null; }

export function createDomainSyncRouter(database: SyncQueryable, auth: AuthStore, secret: Uint8Array): Router {
  const router = Router();
  router.use(createAuthenticateMiddleware(auth, secret));

  router.post("/push", async (req, res) => {
    const pg = pool(database);
    if (!pg) return res.status(503).json({ error: { code: "SYNC_UNAVAILABLE" } });
    const userId = requirePrincipal(req).userId;
    try {
      const body = obj(req.body);
      if (body.protocol_version !== 1 || typeof body.batch_id!=="string" || !UUID.test(body.batch_id) || !Array.isArray(body.operations) || body.operations.length < 1 || body.operations.length > 50 || Buffer.byteLength(JSON.stringify(body),"utf8")>512*1024) return res.status(400).json({ error: { code: "INVALID_BATCH" } });
      const deviceId = uuid(body.device_id);
      const registered = await database.query("SELECT id FROM sync_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [deviceId,userId]);
      if (!registered.rows.length) return res.status(403).json({ error: { code: "DEVICE_NOT_REGISTERED" } });
      const results: Record<string, unknown>[] = [];
      for (const raw of body.operations) {
        const op = obj(raw), entity = op.entity_type as Entity;
        if (!Object.hasOwn(specs,entity)) return res.status(400).json({ error: { code: "UNSUPPORTED_ENTITY" } });
        const spec = specs[entity];
        const id = uuid(op.entity_id), operationId = uuid(op.operation_id);
        if (!(["create","update","delete"] as unknown[]).includes(op.action) || !Number.isSafeInteger(op.base_version) || (op.base_version as number)<0 || !Number.isSafeInteger(op.local_revision) || (op.local_revision as number)<1) return res.status(400).json({ error: { code: "INVALID_OPERATION" } });
        const p = obj(op.payload);
        if ((op.action==="create"&&op.base_version!==0)||(op.action!=="create"&&(op.base_version as number)<1)) return res.status(400).json({error:{code:"INVALID_BASE_VERSION"}});
        if (uuid(p.id) !== id) return res.status(400).json({ error: { code: "ENTITY_ID_MISMATCH" } });
        if(!Array.isArray(op.depends_on)||op.depends_on.length>50) return res.status(400).json({error:{code:"INVALID_DEPENDENCIES"}});
        const dependencies=(op.depends_on as unknown[]).map(uuid);
        if(new Set(dependencies).size!==dependencies.length||dependencies.includes(operationId)) return res.status(400).json({error:{code:"INVALID_DEPENDENCIES"}});
        dateFields(p, String(op.action));
        const values: Record<string, unknown> = {};
        for (const field of spec.fields) if (Object.hasOwn(p,field)) values[field] = p[field];
        // Owner is always sourced from the verified access token.
        if ("enabled" in values) values.enabled = values.enabled===true || values.enabled===1;
        const allowed = new Set([...spec.fields,"id","owner_id","version","created_at","updated_at","deleted_at"]);
        if (Object.keys(p).some((k)=>!allowed.has(k))) return res.status(400).json({error:{code:"INVALID_PAYLOAD_FIELDS",fields:Object.keys(p).filter(k=>!allowed.has(k))}});
        if (requiredOnCreate[entity].some((f)=>!(f in values)||values[f]===null) && op.action === "create") return res.status(400).json({error:{code:"INVALID_REQUIRED_FIELD",fields:requiredOnCreate[entity].filter(f=>!(f in values)||values[f]===null)}});
        if(entity==="calendar_reminder"&&values.calendar_event_id){
          const target=await database.query<{pet_id:string|null}&QueryResultRow>("SELECT pet_id FROM calendar_events WHERE owner_id=$1 AND id=$2",[userId,values.calendar_event_id]);
          if(target.rows[0]&&target.rows[0].pet_id!==(values.pet_id??null))return res.status(400).json({error:{code:"TARGET_PET_MISMATCH"}});
        }
        const hash = createHash("sha256").update(canonical({protocol_version:1,...op})).digest("hex");
        const client = await pg.connect();
        try {
          await client.query("BEGIN");
          const receipt = await client.query<{request_hash:string;response:Record<string,unknown>} & QueryResultRow>(
            `INSERT INTO sync_operations(user_id,operation_id,request_hash,response) VALUES($1,$2,$3,'{"status":"processing"}') ON CONFLICT(user_id,operation_id) DO UPDATE SET operation_id=EXCLUDED.operation_id RETURNING request_hash,response`,[userId,operationId,hash]);
          const stored=receipt.rows[0];
          if(stored.request_hash.trim()!==hash) { await client.query("ROLLBACK"); results.push({operation_id:operationId,entity_type:entity,entity_id:id,status:"rejected",code:"OPERATION_ID_REUSED"}); continue; }
          if(stored.response.status!=="processing") { await client.query("COMMIT"); results.push(stored.response); continue; }
          let dependenciesReady=true;
          for(const depId of dependencies){
            const dep=await client.query<{response:Record<string,unknown>}&QueryResultRow>("SELECT response FROM sync_operations WHERE user_id=$1 AND operation_id=$2",[userId,depId]);
            if(!dep.rows[0]||!['applied','already_applied'].includes(String(dep.rows[0].response.status))){dependenciesReady=false;break;}
          }
          if(!dependenciesReady){await client.query("ROLLBACK");results.push({operation_id:operationId,entity_type:entity,entity_id:id,status:"dependency_blocked",code:"DEPENDENCY_NOT_APPLIED"});continue;}
          await client.query("SELECT set_config('petcare.sync_operation_id',$1,true)",[operationId]);
          await client.query("SELECT set_config('petcare.sync_changed_fields',$1,true)",[JSON.stringify(Array.isArray(op.changed_fields)?op.changed_fields:[])]);
          let row: Record<string,unknown>|undefined;
          if(op.action==="create") {
            const existing=await client.query<Record<string,unknown>&QueryResultRow>(`SELECT owner_id,version,* FROM ${spec.table} WHERE id=$1`,[id]);
            if(existing.rows[0]){
              const own=String(existing.rows[0].owner_id)===userId;
              const conflict={operation_id:operationId,entity_type:entity,entity_id:id,status:own?"conflict":"rejected",code:own?"ENTITY_ALREADY_EXISTS":"IDENTITY_COLLISION",...(own?{server_version:Number(existing.rows[0].version),server_snapshot:existing.rows[0]}:{})};
              await client.query("UPDATE sync_operations SET response=$3::jsonb WHERE user_id=$1 AND operation_id=$2",[userId,operationId,JSON.stringify(conflict)]);await client.query("COMMIT");results.push(conflict);continue;
            }
            const columns=["id","owner_id",...Object.keys(values),"created_at","updated_at"];
            const vals:unknown[]=[id,userId,...Object.values(values),p.created_at??new Date().toISOString(),p.updated_at??new Date().toISOString()];
            const marks=vals.map((_,i)=>`$${i+1}`).join(",");
            const r=await client.query<Record<string,unknown>&QueryResultRow>(`INSERT INTO ${spec.table}(${columns.join(",")}) VALUES(${marks}) RETURNING *`,vals); row=r.rows[0];
          } else {
            const expected=op.base_version as number;
            const r=op.action==="delete"
              ? await client.query<Record<string,unknown>&QueryResultRow>(`UPDATE ${spec.table} SET deleted_at=$4,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING *`,[userId,id,expected,p.deleted_at])
              : await client.query<Record<string,unknown>&QueryResultRow>(`UPDATE ${spec.table} SET ${Object.keys(values).map((f,i)=>`${f}=$${i+4}`).join(",")},version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING *`,[userId,id,expected,...Object.values(values)]);
            row=r.rows[0];
          }
          if(!row) {
            const r=await client.query<Record<string,unknown>&QueryResultRow>(`SELECT * FROM ${spec.table} WHERE owner_id=$1 AND id=$2`,[userId,id]);
            const result={operation_id:operationId,entity_type:entity,entity_id:id,status:r.rows[0]?"conflict":"rejected",...(r.rows[0]?{code:"VERSION_CONFLICT",server_version:r.rows[0].version,server_snapshot:r.rows[0]}:{code:"ENTITY_NOT_FOUND"})};
            await client.query("UPDATE sync_operations SET response=$3::jsonb WHERE user_id=$1 AND operation_id=$2",[userId,operationId,JSON.stringify(result)]); await client.query("COMMIT"); results.push(result); continue;
          }
          const feed=await client.query<{cursor:string}&QueryResultRow>("SELECT cursor::text AS cursor FROM sync_changes WHERE owner_id=$1 AND operation_id=$2 ORDER BY cursor DESC LIMIT 1",[userId,operationId]);
          const result={operation_id:operationId,entity_type:entity,entity_id:id,status:"applied",server_version:Number(row.version),cursor:feed.rows[0]?.cursor,server_snapshot:row};
          await client.query("UPDATE sync_operations SET response=$3::jsonb WHERE user_id=$1 AND operation_id=$2",[userId,operationId,JSON.stringify(result)]); await client.query("COMMIT"); results.push(result);
        } catch(error) {
          await client.query("ROLLBACK");
          const code=(error as {code?:string}).code;
          if(["23503","23505","23514","22P02","22007"].includes(String(code))){results.push({operation_id:operationId,entity_type:entity,entity_id:id,status:"rejected",code:"INVALID_RELATION_OR_VALUE"});continue;}
          throw error;
        } finally { client.release(); }
      }
      return res.status(200).json({protocol_version:1,results});
    } catch { return res.status(400).json({error:{code:"INVALID_DOMAIN_OPERATION",message:"The domain sync batch contains invalid data or relationships."}}); }
  });

  router.post("/pull", async(req,res)=>{
    try {
      const body=obj(req.body), userId=requirePrincipal(req).userId, deviceId=uuid(body.device_id);
      const after=String(body.after_cursor??"0"), limit=Number(body.limit??200);
      if(!/^(0|[1-9]\d*)$/.test(after)||!Number.isSafeInteger(limit)||limit<1||limit>500) return res.status(400).json({error:{code:"INVALID_CURSOR"}});
      const registered=await database.query("SELECT id FROM sync_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",[deviceId,userId]);
      if(!registered.rows.length) return res.status(403).json({error:{code:"DEVICE_NOT_REGISTERED"}});
      const current=await database.query<{last_cursor:string}&QueryResultRow>("SELECT last_cursor::text AS last_cursor FROM sync_cursors WHERE owner_id=$1",[userId]);
      if(BigInt(after)>BigInt(current.rows[0]?.last_cursor??"0"))return res.status(409).json({error:{code:"CURSOR_AHEAD"}});
      const feed=await database.query<{cursor:string;entity_type:Entity;entity_id:string;entity_version:number;change_type:string}&QueryResultRow>(`SELECT cursor::text,entity_type,entity_id,entity_version,change_type FROM sync_changes WHERE owner_id=$1 AND cursor>$2 AND entity_type IN ('health_record','care_task','care_execution','appointment','calendar_event','calendar_reminder') ORDER BY cursor LIMIT $3`,[userId,after,limit+1]);
      const hasMore=feed.rows.length>limit, rows=feed.rows.slice(0,limit), changes=[];
      for(const entry of rows){const spec=specs[entry.entity_type];const r=await database.query<Record<string,unknown>&QueryResultRow>(`SELECT * FROM ${spec.table} WHERE owner_id=$1 AND id=$2`,[userId,entry.entity_id]); if(r.rows[0])changes.push({...r.rows[0],entity_type:entry.entity_type,entity_version:Number(r.rows[0].version),change_type:entry.change_type,cursor:entry.cursor});}
      return res.status(200).json({protocol_version:1,changes,next_cursor:rows.at(-1)?.cursor??after,has_more:hasMore});
    } catch { return res.status(400).json({error:{code:"INVALID_PULL_REQUEST"}}); }
  });
  return router;
}
