import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { migrations } from "../src/db/migrations/index.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import type { Logger } from "../src/observability/logger.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.PETCARE_RUN_AUTH_DB_TESTS === "1";
const secret = Buffer.from("postgres-sync-integration-secret-at-least-32-bytes");
const password = "postgres sync integration password";
const logger: Logger = { info: () => {}, error: () => {} };

interface AuthResponse { accessToken: string; user: { id: string } }
interface PushResult {
  operation_id: string;
  status: string;
  server_version?: number;
  cursor?: string;
  server_snapshot?: Record<string, unknown>;
  code?: string;
}
interface PushResponse { results: PushResult[] }
interface PullResponse {
  changes: Array<Record<string, unknown> & { id: string; entity_version: number; change_type: string; cursor: string; name: string }>;
  next_cursor: string;
  has_more: boolean;
}

test("PostgreSQL pet sync authenticates, isolates owners, replays idempotently, versions conflicts, pages cursors and propagates tombstones", {
  skip: !enabled && "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for disposable petcare_test.",
}, async () => {
  const parsed = new URL(databaseUrl!);
  assert.ok(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:");
  assert.equal(decodeURIComponent(parsed.pathname.replace(/^\//, "")), "petcare_test");
  const pool = createDatabasePool(databaseUrl!);
  const runId = randomUUID();
  const emails = [`sync-${runId}-a@example.test`, `sync-${runId}-b@example.test`];
  let server: Server | undefined;
  let fixturesStarted = false;
  try {
    assert.equal((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0].database, "petcare_test");
    const applied = await pool.query<{ version: number; name: string; checksum: string }>("SELECT version,name,checksum FROM schema_migrations ORDER BY version");
    const byVersion = new Map(applied.rows.map((item) => [item.version, item]));
    for (const migration of migrations) {
      const row = byVersion.get(migration.version);
      assert.ok(row, `Migration ${migration.version} is required.`);
      assert.equal(row.name, migration.name);
      assert.equal(row.checksum, createHash("sha256").update(migration.up.toString()).digest("hex"));
    }

    const app = createApp({ config: { corsOrigins: [], accessTokenSecret: secret }, database: pool, authStore: new PostgresAuthStore(pool), logger });
    server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    fixturesStarted = true;

    const ownerA = await register(base, emails[0]);
    const ownerB = await register(base, emails[1]);
    const deviceA = randomUUID();
    const deviceA2 = randomUUID();
    const deviceB = randomUUID();
    assert.equal((await putJson(base, `/sync/v1/devices/${deviceA}`, { platform: "web", schema_version: 7 }, ownerA.accessToken)).status, 200);
    assert.equal((await putJson(base, `/sync/v1/devices/${deviceA2}`, { platform: "android", schema_version: 7 }, ownerA.accessToken)).status, 200);
    assert.equal((await putJson(base, `/sync/v1/devices/${deviceB}`, { platform: "web", schema_version: 7 }, ownerB.accessToken)).status, 200);

    const unauthenticated = await postJson(base, "/sync/v1/pull", { device_id: deviceA, after_cursor: "0" });
    assert.equal(unauthenticated.status, 401);
    const foreignDevice = await postJson(base, "/sync/v1/pull", { device_id: deviceA, after_cursor: "0" }, ownerB.accessToken);
    assert.equal(foreignDevice.status, 403);

    const petId = randomUUID();
    const createId = randomUUID();
    const createdAt = new Date().toISOString();
    const createOperation = operation({
      operation_id: createId, entity_id: petId, action: "create", base_version: 0,
      local_revision: 1, depends_on: [], changed_fields: ["name", "species"],
      payload: petPayload(petId, "Tina", createdAt, null),
    });
    const unsafe = structuredClone(createOperation) as Record<string, any>;
    unsafe.payload.owner_id = ownerB.user.id;
    assert.equal((await push(base, ownerA.accessToken, deviceA, randomUUID(), [unsafe])).status, 400);
    const localPhotoOnly = structuredClone(createOperation) as Record<string, any>;
    localPhotoOnly.payload.photo_storage_key = "pet-photos/device-local.jpg";
    assert.equal((await push(base, ownerA.accessToken, deviceA, randomUUID(), [localPhotoOnly])).status, 400);

    const created = await push(base, ownerA.accessToken, deviceA, randomUUID(), [createOperation]);
    assert.equal(created.status, 200);
    const createdResult = (await readJson<PushResponse>(created)).results[0];
    assert.equal(createdResult.status, "applied");
    assert.equal(createdResult.server_version, 1);
    assert.ok(createdResult.cursor);
    const sameReplay = await readJson<PushResponse>(await push(base, ownerA.accessToken, deviceA, randomUUID(), [createOperation]));
    assert.equal(sameReplay.results[0].status, "applied");
    assert.equal(Number((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM pets WHERE owner_id=$1 AND id=$2", [ownerA.user.id, petId])).rows[0].count), 1);
    assert.equal(Number((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM sync_changes WHERE owner_id=$1 AND operation_id=$2", [ownerA.user.id, createId])).rows[0].count), 1);

    const reused = structuredClone(createOperation);
    reused.payload.name = "Changed payload";
    const reusedResponse = await push(base, ownerA.accessToken, deviceA, randomUUID(), [reused]);
    assert.equal(reusedResponse.status, 409);
    assert.equal((await reusedResponse.json()).error.code, "OPERATION_ID_REUSED");

    // Existing /pets writes also enter the sync feed through the database trigger.
    const legacyPet = await postJson(base, "/pets", { name: "Legacy path", species: "dog" }, ownerA.accessToken);
    assert.equal(legacyPet.status, 201);
    const firstPageResponse = await postJson(base, "/sync/v1/pull", { device_id: deviceA, after_cursor: "0", limit: 1 }, ownerA.accessToken);
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await readJson<PullResponse>(firstPageResponse);
    assert.equal(firstPage.changes.length, 1);
    assert.equal(firstPage.has_more, true);
    const secondPage = await readJson<PullResponse>(await postJson(base, "/sync/v1/pull", { device_id: deviceA, after_cursor: firstPage.next_cursor, limit: 1 }, ownerA.accessToken));
    assert.equal(secondPage.changes.length, 1);
    assert.equal(secondPage.has_more, false);
    assert.ok(BigInt(secondPage.next_cursor) > BigInt(firstPage.next_cursor));
    assert.equal((await postJson(base, "/sync/v1/ack", { device_id: deviceA, cursor: secondPage.next_cursor }, ownerA.accessToken)).status, 200);
    assert.equal((await postJson(base, "/sync/v1/ack", { device_id: deviceA, cursor: "999999" }, ownerA.accessToken)).status, 409);

    const ownerBPull = await readJson<PullResponse>(await postJson(base, "/sync/v1/pull", { device_id: deviceB, after_cursor: "0" }, ownerB.accessToken));
    assert.deepEqual(ownerBPull.changes, []);

    const prerequisiteId = randomUUID();
    const prerequisitePetId = randomUUID();
    const update = operation({
      operation_id: randomUUID(), entity_id: petId, action: "update", base_version: 1,
      local_revision: 2, depends_on: [createId, prerequisiteId], changed_fields: ["name"],
      payload: petPayload(petId, "Tina Updated", createdAt, null),
    });
    const blocked = await readJson<PushResponse>(await push(base, ownerA.accessToken, deviceA, randomUUID(), [update]));
    assert.equal(blocked.results[0].status, "dependency_blocked");
    assert.equal(Number((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM sync_operations WHERE user_id=$1 AND operation_id=$2", [ownerA.user.id, update.operation_id])).rows[0].count), 0);
    const prerequisite = operation({
      operation_id: prerequisiteId, entity_id: prerequisitePetId, action: "create", base_version: 0,
      local_revision: 1, depends_on: [], changed_fields: ["name", "species"],
      payload: petPayload(prerequisitePetId, "Prerequisite", createdAt, null),
    });
    assert.equal((await readJson<PushResponse>(await push(base, ownerA.accessToken, deviceA, randomUUID(), [prerequisite]))).results[0].status, "applied");
    const updated = await readJson<PushResponse>(await push(base, ownerA.accessToken, deviceA, randomUUID(), [update]));
    assert.equal(updated.results[0].status, "applied");
    assert.equal(updated.results[0].server_version, 2);

    const stale = operation({
      operation_id: randomUUID(), entity_id: petId, action: "update", base_version: 1,
      local_revision: 3, depends_on: [createId, update.operation_id], changed_fields: ["name"],
      payload: petPayload(petId, "Stale write", createdAt, null),
    });
    const conflict = await readJson<PushResponse>(await push(base, ownerA.accessToken, deviceA2, randomUUID(), [stale]));
    assert.equal(conflict.results[0].status, "conflict");
    assert.equal(conflict.results[0].server_version, 2);
    assert.equal(conflict.results[0].server_snapshot?.name, "Tina Updated");

    const tombstone = operation({
      operation_id: randomUUID(), entity_id: petId, action: "delete", base_version: 2,
      local_revision: 4, depends_on: [createId, prerequisiteId, update.operation_id], changed_fields: ["deleted_at"],
      payload: petPayload(petId, "Tina Updated", createdAt, new Date().toISOString()),
    });
    const deleted = await readJson<PushResponse>(await push(base, ownerA.accessToken, deviceA, randomUUID(), [tombstone]));
    assert.equal(deleted.results[0].status, "applied");
    const deviceTwoPull = await readJson<PullResponse>(await postJson(base, "/sync/v1/pull", { device_id: deviceA2, after_cursor: "0", limit: 50 }, ownerA.accessToken));
    const tombstoneChange = deviceTwoPull.changes.find((change) => change.id === petId && change.change_type === "delete");
    assert.ok(tombstoneChange);
    assert.ok(tombstoneChange.deleted_at);
  } finally {
    try {
      if (server) { const closed = once(server, "close"); server.close(); await closed; }
      if (fixturesStarted) {
        const owners = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = ANY($1::text[])", [emails]);
        const ids = owners.rows.map((owner) => owner.id);
        await pool.query("DELETE FROM sync_changes WHERE owner_id=ANY($1::uuid[])", [ids]);
        await pool.query("DELETE FROM sync_operations WHERE user_id=ANY($1::uuid[])", [ids]);
        await pool.query("DELETE FROM sync_devices WHERE user_id=ANY($1::uuid[])", [ids]);
        await pool.query("DELETE FROM sync_cursors WHERE owner_id=ANY($1::uuid[])", [ids]);
        await pool.query("DELETE FROM pets WHERE owner_id=ANY($1::uuid[])", [ids]);
        await pool.query(`DELETE FROM auth_refresh_tokens t USING auth_sessions s WHERE t.session_id=s.id AND s.user_id=ANY($1::uuid[])`, [ids]);
        await pool.query("DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])", [ids]);
        await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
        const residual = await pool.query<{ users: string; pets: string; devices: string; cursors: string; operations: string; changes: string }>(
          `SELECT
             (SELECT count(*)::text FROM users WHERE email=ANY($1::text[])) AS users,
             (SELECT count(*)::text FROM pets WHERE owner_id=ANY($2::uuid[])) AS pets,
             (SELECT count(*)::text FROM sync_devices WHERE user_id=ANY($2::uuid[])) AS devices,
             (SELECT count(*)::text FROM sync_cursors WHERE owner_id=ANY($2::uuid[])) AS cursors,
             (SELECT count(*)::text FROM sync_operations WHERE user_id=ANY($2::uuid[])) AS operations,
             (SELECT count(*)::text FROM sync_changes WHERE owner_id=ANY($2::uuid[])) AS changes`,
          [emails, ids],
        );
        for (const [table, count] of Object.entries(residual.rows[0])) assert.equal(Number(count), 0, `Sync ${table} fixtures were not cleaned for run ${runId}.`);
      }
    } finally { await pool.end(); }
  }
});

function operation(input: {
  operation_id: string; entity_id: string; action: "create" | "update" | "delete";
  base_version: number; local_revision: number; depends_on: string[]; changed_fields: string[];
  payload: Record<string, unknown>;
}) {
  return { ...input, entity_type: "pet" };
}

function petPayload(id: string, name: string, createdAt: string, deletedAt: string | null) {
  return { id, name, species: "cat", breed: null, sex: null, birth_date: null,
    approximate_age_months: null, weight_kg: null, color: null, notes: null,
    created_at: createdAt, updated_at: new Date().toISOString(), deleted_at: deletedAt };
}

async function register(base: string, email: string): Promise<AuthResponse> {
  const response = await postJson(base, "/auth/register", { email, password, name: "Sync integration owner" });
  assert.equal(response.status, 201);
  return readJson<AuthResponse>(response);
}

async function postJson(base: string, path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

async function putJson(base: string, path: string, body: unknown, token: string): Promise<Response> {
  return fetch(`${base}${path}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

async function push(base: string, token: string, deviceId: string, batchId: string, operations: unknown[]): Promise<Response> {
  return postJson(base, "/sync/v1/push", { protocol_version: 1, device_id: deviceId, batch_id: batchId, operations }, token);
}

function readJson<T>(response: Response): Promise<T> { return response.json() as Promise<T>; }
