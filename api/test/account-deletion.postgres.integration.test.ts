import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import { runAccountDeletionBatch } from "../src/modules/auth/accountDeletionWorker.js";
import type { MediaObjectStore } from "../src/modules/media/objectStore.js";
import type { Logger } from "../src/observability/logger.js";
import { assertMigrationsApplied } from "./assertMigrations.js";

const url = process.env.PETCARE_TEST_DATABASE_URL;
const enabled = Boolean(url) && process.env.PETCARE_RUN_AUTH_DB_TESTS === "1";
const secret = Buffer.from("account-deletion-test-secret-at-least-32-bytes");
const logger: Logger = { info: () => {}, error: () => {} };

class MemoryStore implements MediaObjectStore {
  readonly objects = new Set<string>();
  failDelete = false;
  onPut?: () => void;
  beforePut?: () => Promise<void>;
  async put(key: string): Promise<void> { this.onPut?.(); await this.beforePut?.(); this.objects.add(key); }
  async get(): Promise<Readable> { throw new Error("Not used by deletion test."); }
  async delete(key: string): Promise<void> {
    if (this.failDelete) throw Object.assign(new Error("Simulated storage outage."), { code: "MEDIA_STORAGE_UNAVAILABLE" });
    this.objects.delete(key);
  }
  async list(prefix: string, continuationToken?: string) {
    const keys = [...this.objects].filter((key) => key.startsWith(prefix)).sort();
    const start = continuationToken ? Number(continuationToken) : 0;
    const page = keys.slice(start, start + 100);
    const next = start + page.length;
    return { keys: page.map((key) => ({ key })), ...(next < keys.length ? { continuationToken: String(next) } : {}) };
  }
}

async function createUser(base: string, email: string) {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "integration secure password", name: "Deletion Fixture" }),
  });
  assert.equal(response.status, 201);
  return await response.json() as { user: { id: string }; accessToken: string; refreshToken: string };
}

async function countFor(pool: Pool, table: string, ownerColumn: string, userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE ${ownerColumn}=$1`, [userId]);
  return Number(result.rows[0].count);
}

test("permanent deletion revokes access, retries storage failures, removes only the owner's rows and remote objects", {
  skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for petcare_test.",
}, async () => {
  const target = new URL(url!);
  assert.equal(decodeURIComponent(target.pathname.replace(/^\//, "")), "petcare_test", "Refusing a database other than petcare_test.");
  const pool = createDatabasePool(url!);
  const store = new MemoryStore();
  const runId = randomUUID();
  const emails = [`delete-${runId}-a@example.test`, `delete-${runId}-b@example.test`];
  const userIds: string[] = [];
  const requestIds: string[] = [];
  let server: Server | undefined;
  try {
    await assertMigrationsApplied(pool, ["account_lifecycle", "kirai_conversations", "media_storage", "account_deletion_worker"]);
    server = createServer(createApp({
      config: { corsOrigins: [], accessTokenSecret: secret },
      database: pool,
      authStore: new PostgresAuthStore(pool),
      logger,
      mediaStore: store,
    }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const a = await createUser(base, emails[0]);
    const b = await createUser(base, emails[1]);
    userIds.push(a.user.id, b.user.id);

    const pets = await Promise.all([a, b].map(async (tokens) => {
      const response = await fetch(`${base}/pets`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.accessToken}` },
        body: JSON.stringify({ name: "Deletion test pet", species: "cat" }),
      });
      assert.equal(response.status, 201);
      return (await response.json() as { pet: { id: string } }).pet.id;
    }));
    const [petA, petB] = pets;
    const recordA = randomUUID(), taskA = randomUUID(), executionA = randomUUID(), appointmentA = randomUUID(), eventA = randomUUID();
    const photoAsset = randomUUID(), attachmentAsset = randomUUID(), conversation = randomUUID();
    const now = new Date().toISOString();

    await pool.query("INSERT INTO health_records(id,owner_id,pet_id,record_type,title,occurred_at) VALUES($1,$2,$3,'observation','fixture',now())", [recordA,a.user.id,petA]);
    await pool.query("INSERT INTO health_attachments(id,owner_id,pet_id,health_record_id,storage_key,original_filename,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,'visit.pdf','application/pdf',10)", [attachmentAsset,a.user.id,petA,recordA,`media/${a.user.id}/${attachmentAsset}/sum`]);
    await pool.query("INSERT INTO care_tasks(id,owner_id,pet_id,task_type,title,timezone,starts_at) VALUES($1,$2,$3,'feeding','fixture','UTC',$4)", [taskA,a.user.id,petA,now]);
    await pool.query("INSERT INTO care_task_executions(id,owner_id,task_id,pet_id,scheduled_for,status) VALUES($1,$2,$3,$4,$5,'omitted')", [executionA,a.user.id,taskA,petA,now]);
    await pool.query("INSERT INTO appointments(id,owner_id,pet_id,title,starts_at) VALUES($1,$2,$3,'fixture',$4)", [appointmentA,a.user.id,petA,now]);
    await pool.query("INSERT INTO calendar_events(id,owner_id,pet_id,title,category,starts_at,timezone) VALUES($1,$2,$3,'fixture','birthday',$4,'UTC')", [eventA,a.user.id,petA,now]);
    await pool.query("INSERT INTO calendar_reminders(id,owner_id,pet_id,calendar_event_id,title,remind_at,timezone) VALUES($1,$2,$3,$4,'fixture',$5,'UTC')", [randomUUID(),a.user.id,petA,eventA,now]);
    await pool.query("INSERT INTO reminders(id,owner_id,pet_id,title,due_at) VALUES($1,$2,$3,'fixture',$4)", [randomUUID(),a.user.id,petA,now]);
    await pool.query("INSERT INTO media_objects(id,owner_id,purpose,pet_id,health_record_id,object_key,original_filename,mime_type,size_bytes,sha256) VALUES($1,$2,'pet_photo',$3,NULL,$4,'pet.png','image/png',10,$5),($6,$2,'health_attachment',$3,$8,$7,'visit.pdf','application/pdf',10,$5)", [photoAsset,a.user.id,petA,`media/${a.user.id}/${photoAsset}/sum`,'a'.repeat(64),attachmentAsset,`media/${a.user.id}/${attachmentAsset}/sum`,recordA]);
    await pool.query("INSERT INTO kirai_conversations(id,owner_id,title) VALUES($1,$2,'fixture')", [conversation,a.user.id]);
    await pool.query("INSERT INTO kirai_messages(id,owner_id,conversation_id,role,content,client_request_id,request_status) VALUES($1,$2,$3,'user','fixture',$1,'complete')", [randomUUID(),a.user.id,conversation]);
    const syncDevice = randomUUID(), operation = randomUUID();
    await pool.query("INSERT INTO sync_devices(id,user_id) VALUES($1,$2)", [syncDevice,a.user.id]);
    await pool.query("INSERT INTO sync_operations(user_id,operation_id,request_hash,response) VALUES($1,$2,$3,'{}'::jsonb)", [a.user.id,operation,"b".repeat(64)]);
    await pool.query("INSERT INTO sync_changes(owner_id,cursor,entity_type,entity_id,entity_version,operation_id,change_type) SELECT $1,COALESCE(max(cursor),0)+1,'pet',$2,1,$3,'upsert' FROM sync_changes WHERE owner_id=$1", [a.user.id,petA,operation]);
    await pool.query("INSERT INTO sync_cursors(owner_id,last_cursor) VALUES($1,1) ON CONFLICT(owner_id) DO NOTHING", [a.user.id]);
    const trackerId = Number.parseInt(randomUUID().slice(0,8),16) % 2_000_000_000 + 1;
    await pool.query("INSERT INTO pet_trackers(pet_id,device_id) VALUES($1,$2)", [petA,trackerId]);
    const prefixA = `media/${a.user.id}/`;
    const aKeys = [`${prefixA}${photoAsset}/sum`,`${prefixA}${attachmentAsset}/sum`,`${prefixA}orphan/old`];
    const bKey = `media/${b.user.id}/keep/sum`;
    aKeys.forEach((key) => store.objects.add(key)); store.objects.add(bKey);

    let releaseUpload!: () => void;
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => { signalUploadStarted = resolve; });
    store.onPut = signalUploadStarted;
    store.beforePut = () => new Promise<void>((resolve) => { releaseUpload = resolve; });
    const racingAsset = randomUUID();
    const racingImage = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#2277aa" } }).png().toBuffer();
    const racingHash = createHash("sha256").update(racingImage).digest("hex");
    const uploadPromise = fetch(`${base}/media/pets/${petA}/photo`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png", "Authorization": `Bearer ${a.accessToken}`,
        "X-Upload-Id": racingAsset, "X-Checksum-Sha256": racingHash, "X-File-Name": "race.png",
      },
      body: racingImage,
    });
    await uploadStarted;

    const deletionRequestPromise = fetch(`${base}/auth/deletion-request`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.accessToken}` },
      body: JSON.stringify({ currentPassword: "integration secure password" }),
    });
    let deletionWasBlockedByUpload = false;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await pool.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE datname=current_database() AND wait_event_type='Lock'
               AND query LIKE 'UPDATE users SET deleted_at%'
           ) AS waiting`,
        );
        if (waiting.rows[0]?.waiting) { deletionWasBlockedByUpload = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      releaseUpload();
      store.onPut = undefined;
      store.beforePut = undefined;
    }
    const uploadResponse = await uploadPromise;
    assert.equal(uploadResponse.status, 201, "An upload already in progress should finish before account deactivation.");
    assert.equal(deletionWasBlockedByUpload, true, "Account deactivation must wait for an upload holding the owner row lock.");
    const requestResponse = await deletionRequestPromise;
    assert.equal(requestResponse.status, 202);
    const requestBody = await requestResponse.json() as { requestId: string; status: string };
    requestIds.push(requestBody.requestId);
    assert.equal(requestBody.status, "pending_permanent_deletion");
    assert.equal((await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${a.accessToken}` } })).status, 401);
    assert.equal((await fetch(`${base}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: a.refreshToken }) })).status, 401);

    store.failDelete = true;
    assert.deepEqual(await runAccountDeletionBatch(pool, store, logger), { claimed: 1, completed: 0, deferred: 1 });
    const held = await pool.query<{ status: string; attempt_count: number; last_error_code: string }>("SELECT status,attempt_count,last_error_code FROM account_deletion_requests WHERE request_id=$1", [requestBody.requestId]);
    assert.equal(held.rows[0].status, "pending"); assert.equal(held.rows[0].attempt_count, 1); assert.equal(held.rows[0].last_error_code, "MEDIA_STORAGE_UNAVAILABLE");
    assert.equal((await pool.query("SELECT 1 FROM users WHERE id=$1", [a.user.id])).rowCount, 1, "Database rows must remain until remote files are removable.");

    await pool.query("UPDATE account_deletion_requests SET next_attempt_at=now() WHERE request_id=$1", [requestBody.requestId]);
    store.failDelete = false;
    assert.deepEqual(await runAccountDeletionBatch(pool, store, logger), { claimed: 1, completed: 1, deferred: 0 });
    assert.equal([...store.objects].some((key) => key.startsWith(prefixA)), false, "Owned remote objects and unreferenced owner-prefix objects must be removed.");
    assert.equal(store.objects.has(bKey), true, "Another owner's remote object must remain.");
    assert.equal((await pool.query("SELECT 1 FROM users WHERE id=$1", [a.user.id])).rowCount, 0);
    const completed = await pool.query<{ user_id: string | null; status: string; completed_at: Date | null }>("SELECT user_id,status,completed_at FROM account_deletion_requests WHERE request_id=$1", [requestBody.requestId]);
    assert.deepEqual(completed.rows[0], { user_id: null, status: "completed", completed_at: completed.rows[0].completed_at });
    assert.ok(completed.rows[0].completed_at);
    for (const [table, column] of [["pets","owner_id"],["health_records","owner_id"],["care_tasks","owner_id"],["care_task_executions","owner_id"],["appointments","owner_id"],["calendar_events","owner_id"],["calendar_reminders","owner_id"],["health_attachments","owner_id"],["media_objects","owner_id"],["kirai_conversations","owner_id"],["kirai_messages","owner_id"],["sync_devices","user_id"],["sync_operations","user_id"],["sync_changes","owner_id"],["sync_cursors","owner_id"],["auth_sessions","user_id"]] as const) {
      assert.equal(await countFor(pool,table,column,a.user.id),0,`${table} rows remain for the deleted owner.`);
    }
    assert.equal(await countFor(pool,"pets","owner_id",b.user.id),1,"Unrelated account rows must be preserved.");
    assert.deepEqual(await runAccountDeletionBatch(pool,store,logger),{claimed:0,completed:0,deferred:0},"Completed request is idempotent.");
  } finally {
    if (server) { const closed=once(server,"close"); server.close(); await closed; }
    // The test-created B account is removed using the same guarded worker.
    for (const userId of userIds) {
      const exists = await pool.query("SELECT 1 FROM users WHERE id=$1", [userId]).catch(() => ({ rowCount: 0 } as never));
      if (exists.rowCount) {
        const request = await pool.query<{ request_id: string }>(
          `INSERT INTO account_deletion_requests(user_id,status) VALUES($1,'pending')
           ON CONFLICT(user_id) WHERE user_id IS NOT NULL DO UPDATE SET status='pending',next_attempt_at=now(),processing_started_at=NULL
           RETURNING request_id`, [userId]).catch(() => ({ rows: [] } as never));
        if (request.rows[0]) {
          requestIds.push(request.rows[0].request_id);
          store.failDelete=false;
          await runAccountDeletionBatch(pool,store,logger).catch(() => undefined);
        }
      }
    }
    if (requestIds.length) await pool.query("DELETE FROM account_deletion_requests WHERE request_id=ANY($1::uuid[])", [requestIds]).catch(() => undefined);
    await pool.query("DELETE FROM account_deletion_requests request USING users WHERE request.user_id=users.id AND users.email=ANY($1::text[])", [emails]).catch(() => undefined);
    await pool.end();
  }
});
