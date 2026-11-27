import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listSyncItemsForAccount, resolveConflictForAccount, retryFailedForAccount } from "../src/features/sync/recoveryCore.ts";

const ownerA = "00000000-0000-4000-8000-000000000001";
const ownerB = "00000000-0000-4000-8000-000000000002";
const pet = "00000000-0000-4000-8000-000000000003";
const oldOperation = "00000000-0000-4000-8000-000000000004";
const conflict = "00000000-0000-4000-8000-000000000005";
const parentOperation = "00000000-0000-4000-8000-000000000006";
const dependentOperation = "00000000-0000-4000-8000-000000000007";

function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE sync_queue(operation_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,base_version INTEGER NOT NULL,changed_fields TEXT NOT NULL,status TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,local_revision INTEGER NOT NULL,UNIQUE(account_id,operation_id));
    CREATE TABLE sync_queue_dependencies(account_id TEXT NOT NULL,operation_id TEXT NOT NULL,depends_on_operation_id TEXT NOT NULL,PRIMARY KEY(account_id,operation_id,depends_on_operation_id),FOREIGN KEY(account_id,operation_id) REFERENCES sync_queue(account_id,operation_id) ON DELETE CASCADE,FOREIGN KEY(account_id,depends_on_operation_id) REFERENCES sync_queue(account_id,operation_id) ON DELETE RESTRICT);
    CREATE TABLE sync_conflicts(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,operation_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,base_version INTEGER NOT NULL,server_version INTEGER NOT NULL,local_snapshot TEXT NOT NULL,server_snapshot TEXT NOT NULL,conflicting_fields TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',resolution TEXT,created_at TEXT NOT NULL,resolved_at TEXT,UNIQUE(account_id,operation_id),FOREIGN KEY(account_id,operation_id) REFERENCES sync_queue(account_id,operation_id) ON DELETE RESTRICT);
    CREATE TABLE pets(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT,species TEXT,breed TEXT,sex TEXT,birth_date TEXT,approximate_age_months INTEGER,weight_kg REAL,color TEXT,notes TEXT,photo_storage_key TEXT,version INTEGER,local_revision INTEGER,server_version INTEGER,acknowledged_local_revision INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE health_records(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,pet_id TEXT,record_type TEXT,record_subtype TEXT,title TEXT,description TEXT,occurred_at TEXT,professional_name TEXT,clinic_name TEXT,observations TEXT,details_json TEXT,next_event_at TEXT,version INTEGER,local_revision INTEGER,server_version INTEGER,acknowledged_local_revision INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE care_tasks(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,pet_id TEXT,task_type TEXT,category TEXT,title TEXT,description TEXT,observations TEXT,notes TEXT,recurrence_rule TEXT,schedule_json TEXT,timezone TEXT,starts_at TEXT,next_run_at TEXT,ends_at TEXT,enabled INTEGER,version INTEGER,local_revision INTEGER,server_version INTEGER,acknowledged_local_revision INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE care_task_executions(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,task_id TEXT,pet_id TEXT,scheduled_for TEXT,executed_at TEXT,status TEXT,notes TEXT,version INTEGER,local_revision INTEGER,server_version INTEGER,acknowledged_local_revision INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,pet_id TEXT,title TEXT,starts_at TEXT,ends_at TEXT,location TEXT,notes TEXT,status TEXT,timezone TEXT,version INTEGER,local_revision INTEGER,server_version INTEGER,acknowledged_local_revision INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE calendar_events(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,pet_id TEXT,title TEXT,description TEXT,category TEXT,starts_at TEXT,ends_at TEXT,timezone TEXT,status TEXT,observations TEXT,version INTEGER,local_revision INTEGER,server_version INTEGER,acknowledged_local_revision INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE calendar_reminders(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,pet_id TEXT,calendar_event_id TEXT,care_task_id TEXT,appointment_id TEXT,health_record_id TEXT,title TEXT,remind_at TEXT,lead_minutes INTEGER,timezone TEXT,status TEXT,enabled INTEGER,notes TEXT,version INTEGER,local_revision INTEGER,server_version INTEGER,acknowledged_local_revision INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);`);
  const executor = {
    getFirstAsync: async (sql, ...args) => raw.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql, ...args) => raw.prepare(sql).all(...args),
    runAsync: async (sql, ...args) => raw.prepare(sql).run(...args),
  };
  return { raw, executor };
}

function insertQueue(db, { operation = oldOperation, owner = ownerA, entity = "pet", entityId = pet, status = "conflict", payload = '{"id":"x"}', base = 1, revision = 2, error = "VERSION_CONFLICT" } = {}) {
  db.prepare(`INSERT INTO sync_queue(operation_id,account_id,entity_type,entity_id,action,payload,base_version,changed_fields,status,attempt_count,next_retry_at,last_error,created_at,updated_at,local_revision)
    VALUES(?,?,?,?,?,?,?,?,?,0,NULL,?,'now','now',?)`).run(operation, owner, entity, entityId, "update", payload, base, '["name"]', status, error, revision);
}

function insertConflict(db, { id = conflict, owner = ownerA, operation = oldOperation, entity = "pet", entityId = pet, local, remote, base = 1, remoteVersion = 4 } = {}) {
  db.prepare(`INSERT INTO sync_conflicts(id,account_id,operation_id,entity_type,entity_id,base_version,server_version,local_snapshot,server_snapshot,conflicting_fields,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'now')`).run(id, owner, operation, entity, entityId, base, remoteVersion, JSON.stringify(local), JSON.stringify(remote), '["name"]');
}

test("sync status is scoped to the current local account and includes conflicts and errors", async () => {
  const { raw, executor } = database();
  try {
    insertQueue(raw);
    insertConflict(raw, { local: { name: "A local" }, remote: { name: "A remote", version: 4 } });
    raw.prepare("INSERT INTO pets(id,owner_id,name,species,local_revision) VALUES(?,?,?,?,?)").run(pet, ownerA, "A latest local", "cat", 7);
    insertQueue(raw, { operation: "00000000-0000-4000-8000-000000000008", owner: ownerB, status: "failed", error: "INVALID_RELATION" });
    const rows = await listSyncItemsForAccount(executor, ownerA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].conflict_id, conflict);
    assert.equal(JSON.parse(rows[0].local_snapshot).name, "A latest local");
    assert.equal(rows[0].local_revision, 7);
    assert.equal((await listSyncItemsForAccount(executor, ownerB))[0].status, "failed");
  } finally { raw.close(); }
});

test("safe retry rebuilds from the current local row under a new idempotency key and isolates accounts", async () => {
  const { raw, executor } = database();
  try {
    insertQueue(raw, { status: "failed", error: "INVALID_REQUIRED_FIELD", payload: '{"id":"old-payload"}' });
    raw.prepare("INSERT INTO pets(id,owner_id,name,species,version,local_revision,server_version,acknowledged_local_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(pet, ownerA, "corrected local", "cat", 0, 2, 0, 0, "created", "updated");
    insertQueue(raw, { operation: "00000000-0000-4000-8000-000000000008", owner: ownerB, status: "failed", error: "INVALID_RELATION" });
    const retryId = "00000000-0000-4000-8000-000000000050";
    await retryFailedForAccount(executor, ownerA, oldOperation, () => retryId);
    const retried = raw.prepare("SELECT operation_id,entity_id,action,base_version,status,payload FROM sync_queue WHERE operation_id=?").get(retryId);
    assert.equal(retried.status, "pending");
    assert.equal(retried.entity_id, pet);
    assert.equal(retried.action, "create");
    assert.equal(retried.base_version, 0);
    assert.equal(JSON.parse(retried.payload).name, "corrected local");
    assert.deepEqual({ ...raw.prepare("SELECT status,last_error FROM sync_queue WHERE operation_id=?").get(oldOperation) }, { status: "failed", last_error: "FAILURE_REPLACED_WITH_NEW_OPERATION" });
    assert.equal(raw.prepare("SELECT status FROM sync_queue WHERE account_id=?").get(ownerB).status, "failed");
    await assert.rejects(retryFailedForAccount(executor, ownerB, oldOperation, () => retryId));
  } finally { raw.close(); }
});

test("local conflict resolution creates a new idempotent operation and safely rewires dependencies for pets and all six domains", async () => {
  const { raw, executor } = database();
  const cases = [
    ["pet", "pets", { name: "local pet", species: "dog" }, { name: "remote pet", species: "dog", version: 4 }],
    ["health_record", "health_records", { title: "local record", details_json: '{"dose":2}' }, { title: "remote record", details: { dose: 1 }, version: 4 }],
    ["care_task", "care_tasks", { title: "local care", schedule_json: '{"hour":8}', enabled: 1 }, { title: "remote care", schedule: { hour: 9 }, enabled: true, version: 4 }],
    ["care_execution", "care_task_executions", { status: "completed", notes: "local" }, { status: "skipped", notes: "remote", version: 4 }],
    ["appointment", "appointments", { title: "local appointment" }, { title: "remote appointment", version: 4 }],
    ["calendar_event", "calendar_events", { title: "local event" }, { title: "remote event", version: 4 }],
    ["calendar_reminder", "calendar_reminders", { title: "local reminder", enabled: 1 }, { title: "remote reminder", enabled: true, version: 4 }],
  ];
  try {
    const tableColumns = {
      pet: ["name", "species", "breed", "sex", "birth_date", "approximate_age_months", "weight_kg", "color", "notes"],
      health_record: ["pet_id", "record_type", "record_subtype", "title", "description", "occurred_at", "professional_name", "clinic_name", "observations", "details_json", "next_event_at"],
      care_task: ["pet_id", "task_type", "category", "title", "description", "observations", "notes", "recurrence_rule", "schedule_json", "timezone", "starts_at", "next_run_at", "ends_at", "enabled"],
      care_execution: ["task_id", "pet_id", "scheduled_for", "executed_at", "status", "notes"],
      appointment: ["pet_id", "title", "starts_at", "ends_at", "location", "notes", "status", "timezone"],
      calendar_event: ["pet_id", "title", "description", "category", "starts_at", "ends_at", "timezone", "status", "observations"],
      calendar_reminder: ["pet_id", "calendar_event_id", "care_task_id", "appointment_id", "health_record_id", "title", "remind_at", "lead_minutes", "timezone", "status", "enabled", "notes"],
    };
    for (let index = 0; index < cases.length; index += 1) {
      const [entity, table, localValues, remoteValues] = cases[index];
      const entityId = `00000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`;
      const opId = `00000000-0000-4000-8000-${String(index + 30).padStart(12, "0")}`;
      const conflictId = `00000000-0000-4000-8000-${String(index + 40).padStart(12, "0")}`;
      insertQueue(raw, { operation: opId, entity, entityId, payload: JSON.stringify({ id: entityId }), base: 3, revision: 5 });
      const local = { id: entityId, owner_id: ownerA, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", deleted_at: null, local_revision: 5, server_version: 3, version: 3, ...localValues };
      const remote = { id: entityId, owner_id: "not-trusted", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z", deleted_at: null, ...remoteValues };
      const columns = [...new Set(["id", "owner_id", "created_at", "updated_at", "deleted_at", "version", "local_revision", "server_version", "acknowledged_local_revision", ...tableColumns[entity]])];
      if (!raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) raw.exec(`CREATE TABLE ${table}(${columns.map((column) => `${column} ${["version", "local_revision", "server_version", "acknowledged_local_revision", "approximate_age_months", "lead_minutes", "enabled"].includes(column) ? "INTEGER" : "TEXT"}`).join(",")})`);
      const allLocal = Object.fromEntries(columns.map((column) => [column, local[column] ?? null]));
      raw.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((column) => allLocal[column]));
      if (index === 0) {
        insertQueue(raw, { operation: parentOperation, entity: "pet", entityId: "00000000-0000-4000-8000-000000000099", status: "pending" });
        insertQueue(raw, { operation: dependentOperation, entity: "calendar_event", entityId: "00000000-0000-4000-8000-000000000098", status: "blocked" });
        insertQueue(raw, { operation: "00000000-0000-4000-8000-000000000008", entity: "pet", entityId, status: "blocked", payload: JSON.stringify({ id: entityId, name: "later pet edit" }), base: 2, revision: 6 });
        raw.prepare("INSERT INTO sync_queue_dependencies VALUES(?,?,?)").run(ownerA, opId, parentOperation);
        raw.prepare("INSERT INTO sync_queue_dependencies VALUES(?,?,?)").run(ownerA, dependentOperation, opId);
        raw.prepare("INSERT INTO sync_queue_dependencies VALUES(?,?,?)").run(ownerA, "00000000-0000-4000-8000-000000000008", opId);
      }
      insertConflict(raw, { id: conflictId, operation: opId, entity, entityId, local, remote });
      await resolveConflictForAccount(executor, ownerA, conflictId, "local", () => `00000000-0000-4000-8000-${String(index + 50).padStart(12, "0")}`);
      const replacement = raw.prepare("SELECT operation_id,base_version,status,payload FROM sync_queue WHERE entity_id=? AND operation_id<>? ORDER BY rowid DESC LIMIT 1").get(entityId, opId);
      assert.ok(replacement);
      assert.equal(replacement.operation_id === opId, false);
      assert.equal(replacement.base_version, 4);
      assert.equal(replacement.status, "pending");
      assert.equal(JSON.parse(replacement.payload).owner_id, undefined);
      assert.equal(raw.prepare("SELECT status FROM sync_conflicts WHERE id=?").get(conflictId).status, "resolved");
      if (index === 0) {
        assert.equal(raw.prepare("SELECT depends_on_operation_id FROM sync_queue_dependencies WHERE operation_id=?").get(dependentOperation).depends_on_operation_id, replacement.operation_id);
        assert.equal(raw.prepare("SELECT depends_on_operation_id FROM sync_queue_dependencies WHERE operation_id=?").get(replacement.operation_id).depends_on_operation_id, parentOperation);
        assert.equal(raw.prepare("SELECT status FROM sync_queue WHERE operation_id='00000000-0000-4000-8000-000000000008'").get().status, "failed");
      }
    }
  } finally { raw.close(); }
});

test("server conflict resolution applies the remote tombstone without crossing account boundaries", async () => {
  const { raw, executor } = database();
  try {
    const local = { id: pet, owner_id: ownerA, name: "local", species: "cat", version: 1, local_revision: 2, server_version: 1, acknowledged_local_revision: 1, created_at: "old", updated_at: "old", deleted_at: null };
    const remote = { id: pet, owner_id: ownerB, name: "remote", species: "cat", version: 3, created_at: "old", updated_at: "new", deleted_at: "2026-02-01T00:00:00Z" };
    insertQueue(raw, { owner: ownerA, payload: JSON.stringify(local) });
    insertConflict(raw, { local, remote, remoteVersion: 3 });
    raw.prepare("INSERT INTO pets(id,owner_id,name,species,version,local_revision,server_version,acknowledged_local_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(pet, ownerA, "local", "cat", 1, 2, 1, 1, "old", "old");
    await resolveConflictForAccount(executor, ownerA, conflict, "remote", () => "00000000-0000-4000-8000-000000000050");
    const result = raw.prepare("SELECT owner_id,name,version,server_version,acknowledged_local_revision,deleted_at FROM pets WHERE id=?").get(pet);
    assert.equal(result.owner_id, ownerA);
    assert.equal(result.name, "remote");
    assert.equal(result.server_version, 3);
    assert.equal(result.acknowledged_local_revision, 2);
    assert.equal(result.deleted_at, remote.deleted_at);
  } finally { raw.close(); }
});

test("tombstone conflicts refuse local resurrection but keep dependent operations ordered after remote choice", async () => {
  const { raw, executor } = database();
  try {
    const local = { id: pet, owner_id: ownerA, name: "local", species: "cat", version: 1, local_revision: 2, server_version: 1, created_at: "old", updated_at: "old", deleted_at: null };
    const remote = { id: pet, owner_id: ownerA, name: "remote", species: "cat", version: 3, created_at: "old", updated_at: "new", deleted_at: "2026-02-01T00:00:00Z" };
    insertQueue(raw);
    insertConflict(raw, { local, remote, remoteVersion: 3 });
    raw.prepare("INSERT INTO pets(id,owner_id,name,species,version,local_revision,server_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(pet, ownerA, "local", "cat", 1, 2, 1, "old", "old");
    await assert.rejects(resolveConflictForAccount(executor, ownerA, conflict, "local", () => "00000000-0000-4000-8000-000000000050"), /no permite restaurar/);
    insertQueue(raw, { operation: dependentOperation, owner: ownerA, entity: "calendar_reminder", entityId: "00000000-0000-4000-8000-000000000098", status: "blocked" });
    raw.prepare("INSERT INTO sync_queue_dependencies VALUES(?,?,?)").run(ownerA, dependentOperation, oldOperation);
    await resolveConflictForAccount(executor, ownerA, conflict, "remote", () => "00000000-0000-4000-8000-000000000050");
    assert.equal(raw.prepare("SELECT status FROM sync_conflicts WHERE id=?").get(conflict).status, "resolved");
    assert.equal(raw.prepare("SELECT status FROM sync_queue WHERE operation_id=?").get(dependentOperation).status, "pending");
    assert.equal(raw.prepare("SELECT count(*) AS count FROM sync_queue_dependencies WHERE operation_id=?").get(dependentOperation).count, 0);
  } finally { raw.close(); }
});
