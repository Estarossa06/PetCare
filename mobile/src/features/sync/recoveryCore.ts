export type SyncChoice = "local" | "remote";
export type SyncItem = {
  operation_id: string;
  entity_type: string;
  entity_id: string;
  action: "create" | "update" | "delete";
  status: "pending" | "in_flight" | "blocked" | "conflict" | "failed";
  attempt_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  local_revision: number;
  base_version: number;
  conflict_id: string | null;
  server_version: number | null;
  local_snapshot: string | null;
  server_snapshot: string | null;
  conflicting_fields: string | null;
  dependent_count: number;
  external_dependent_count: number;
};

type Executor = {
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
};

const petFields = ["name", "species", "breed", "sex", "birth_date", "approximate_age_months", "weight_kg", "color", "notes"];
const domainFields: Record<string, string[]> = {
  health_record: ["pet_id", "record_type", "record_subtype", "title", "description", "occurred_at", "professional_name", "clinic_name", "observations", "details", "next_event_at"],
  care_task: ["pet_id", "task_type", "category", "title", "description", "observations", "notes", "recurrence_rule", "schedule", "timezone", "starts_at", "next_run_at", "ends_at", "enabled"],
  care_execution: ["task_id", "pet_id", "scheduled_for", "executed_at", "status", "notes"],
  appointment: ["pet_id", "title", "starts_at", "ends_at", "location", "notes", "status", "timezone"],
  calendar_event: ["pet_id", "title", "description", "category", "starts_at", "ends_at", "timezone", "status", "observations"],
  calendar_reminder: ["pet_id", "calendar_event_id", "care_task_id", "appointment_id", "health_record_id", "title", "remind_at", "lead_minutes", "timezone", "status", "enabled", "notes"],
};
const domainTables: Record<string, string> = {
  health_record: "health_records", care_task: "care_tasks", care_execution: "care_task_executions",
  appointment: "appointments", calendar_event: "calendar_events", calendar_reminder: "calendar_reminders",
};
const localColumns: Record<string, Record<string, string>> = {
  health_record: { details: "details_json" }, care_task: { schedule: "schedule_json" },
  care_execution: {}, appointment: {}, calendar_event: {}, calendar_reminder: { enabled: "enabled" },
};

export async function listSyncItemsForAccount(db: Executor, accountId: string): Promise<SyncItem[]> {
  const rows = await db.getAllAsync<SyncItem>(
    `SELECT q.operation_id,q.entity_type,q.entity_id,q.action,q.status,q.attempt_count,q.next_retry_at,
      q.last_error,q.local_revision,q.base_version,c.id AS conflict_id,c.server_version,
      c.local_snapshot,c.server_snapshot,c.conflicting_fields,
      (SELECT count(*) FROM sync_queue_dependencies d WHERE d.account_id=q.account_id AND d.depends_on_operation_id=q.operation_id) AS dependent_count,
      (SELECT count(DISTINCT d.operation_id) FROM sync_queue_dependencies d JOIN sync_queue parent ON parent.account_id=d.account_id AND parent.operation_id=d.depends_on_operation_id JOIN sync_queue child ON child.account_id=d.account_id AND child.operation_id=d.operation_id WHERE d.account_id=q.account_id AND parent.entity_type=q.entity_type AND parent.entity_id=q.entity_id AND (child.entity_type<>q.entity_type OR child.entity_id<>q.entity_id)) AS external_dependent_count
     FROM sync_queue q
     LEFT JOIN sync_conflicts c ON c.account_id=q.account_id AND c.operation_id=q.operation_id AND c.status='open'
     WHERE q.account_id=? AND q.status IN ('pending','in_flight','blocked','failed','conflict')
       AND (q.status<>'conflict' OR c.id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM sync_conflicts resolved WHERE resolved.account_id=q.account_id AND resolved.operation_id=q.operation_id AND resolved.status<>'open')
       AND (q.last_error IS NULL OR q.last_error NOT IN ('CONFLICT_SUPERSEDED_BY_RESOLUTION','CONFLICT_RESOLVED_REMOTE','CONFLICT_REPLACED_WITH_NEW_OPERATION','FAILURE_REPLACED_WITH_NEW_OPERATION'))
       AND NOT (q.status='failed' AND EXISTS (SELECT 1 FROM sync_conflicts open_conflict WHERE open_conflict.account_id=q.account_id AND open_conflict.entity_type=q.entity_type AND open_conflict.entity_id=q.entity_id AND open_conflict.status='open'))
     ORDER BY CASE q.status WHEN 'conflict' THEN 0 WHEN 'failed' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,q.created_at,q.rowid`,
    accountId,
  );
  for (const item of rows) {
    if (item.status !== "conflict") continue;
    const table = item.entity_type === "pet" ? "pets" : domainTables[item.entity_type];
    if (!table) continue;
    const local = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE owner_id=? AND id=?`, accountId, item.entity_id,
    );
    if (!local) continue;
    item.local_snapshot = JSON.stringify({ ...fromLocal(item.entity_type, local), version: local.version, server_version: local.server_version, local_revision: local.local_revision });
    item.local_revision = Number(local.local_revision ?? item.local_revision);
  }
  return rows;
}

export async function retryFailedForAccount(db: Executor, accountId: string, operationId: string, createOperationId: () => string): Promise<void> {
  const row = await db.getFirstAsync<{ status: string; last_error: string | null; entity_type: string; entity_id: string }>(
    "SELECT status,last_error,entity_type,entity_id FROM sync_queue WHERE account_id=? AND operation_id=?", accountId, operationId,
  );
  if (!row || row.status !== "failed") throw new Error("Esta operación ya no está disponible para reintento.");
  if (["REMOTE_FILE_STORAGE_NOT_CONFIGURED", "CONFLICT_SUPERSEDED_BY_RESOLUTION", "CONFLICT_RESOLVED_REMOTE", "CONFLICT_REPLACED_WITH_NEW_OPERATION", "FAILURE_REPLACED_WITH_NEW_OPERATION"].includes(row.last_error ?? "")) {
    throw new Error("Esta operación no se puede reintentar desde aquí.");
  }
  const table = row.entity_type === "pet" ? "pets" : domainTables[row.entity_type];
  const fields = row.entity_type === "pet" ? petFields : domainFields[row.entity_type];
  if (!table || !fields) throw new Error("Este tipo de operación no se puede reintentar desde la aplicación.");
  const openConflict = await db.getFirstAsync<{ id: string }>("SELECT id FROM sync_conflicts WHERE account_id=? AND entity_type=? AND entity_id=? AND status='open' LIMIT 1", accountId, row.entity_type, row.entity_id);
  if (openConflict) throw new Error("Resuelve primero el conflicto de este registro.");
  const local = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${table} WHERE owner_id=? AND id=?`, accountId, row.entity_id);
  if (!local) throw new Error("El registro local ya no existe; no se modificó la cola.");
  const serverVersion = Number(local.server_version ?? 0);
  if (serverVersion === 0 && local.deleted_at) throw new Error("Este registro se eliminó antes de sincronizarse y no necesita un reintento.");
  const chain = await getActiveEntityChain(db, accountId, row.entity_type, row.entity_id);
  const now = new Date().toISOString();
  const revision = Number(local.local_revision ?? 0) + 1;
  const action = local.deleted_at ? "delete" : serverVersion > 0 ? "update" : "create";
  const payload = fromLocal(row.entity_type, local);
  payload.updated_at = now;
  const changedFields = action === "delete" ? ["deleted_at"] : fields;
  if (action === "delete") payload.deleted_at = local.deleted_at;
  const replacementId = createOperationId().toLowerCase();
  await db.runAsync(`UPDATE ${table} SET local_revision=?,version=?,updated_at=? WHERE owner_id=? AND id=?`, revision, serverVersion, now, accountId, row.entity_id);
  await db.runAsync(
    `INSERT INTO sync_queue(operation_id,account_id,entity_type,entity_id,action,payload,base_version,changed_fields,status,attempt_count,next_retry_at,last_error,created_at,updated_at,local_revision)
     VALUES(?,?,?,?,?,?,?,?, 'pending',0,NULL,NULL,?,?,?)`,
    replacementId, accountId, row.entity_type, row.entity_id, action, JSON.stringify(payload), serverVersion, JSON.stringify(changedFields), now, now, revision,
  );
  await connectReplacement(db, accountId, chain, replacementId);
  await retireEntityChain(db, accountId, chain, "FAILURE_REPLACED_WITH_NEW_OPERATION", JSON.stringify({ choice: "retry-current-local-state", replacement_operation_id: replacementId }));
  await db.runAsync("UPDATE sync_queue SET status='pending',next_retry_at=NULL,updated_at=? WHERE account_id=? AND status='blocked' AND NOT EXISTS(SELECT 1 FROM sync_queue_dependencies d WHERE d.account_id=sync_queue.account_id AND d.operation_id=sync_queue.operation_id)", now, accountId);
}
function normalize(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fromLocal(entity: string, row: Record<string, unknown>): Record<string, unknown> {
  const fields = entity === "pet" ? petFields : domainFields[entity];
  if (!fields) throw new Error("Este tipo de operación no se puede resolver desde PetCare.");
  const mapped = Object.fromEntries(fields.map((field) => {
    const column = localColumns[entity]?.[field] ?? field;
    let value = row[column];
    if ((field === "details" || field === "schedule") && typeof value === "string") {
      try { value = JSON.parse(value); } catch { /* Preserve the value for visible recovery instead of losing it. */ }
    }
    if (field === "enabled") value = value === true || value === 1;
    return [field, value ?? null];
  }));
  return { id: row.id, ...mapped, created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at ?? null };
}

function toLocal(entity: string, key: string, value: unknown): unknown {
  if (entity === "calendar_reminder" && key === "enabled") return value === true || value === 1 ? 1 : 0;
  if ((key === "details" || key === "schedule") && value !== null && typeof value !== "string") return JSON.stringify(value);
  if ((key === "details" || key === "schedule") && typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value)); } catch { return value; }
  }
  return value ?? null;
}

function remoteVersion(snapshot: Record<string, unknown>, fallback: number): number {
  const version = Number(snapshot.version ?? snapshot.entity_version ?? fallback);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("La versión remota del conflicto no es válida.");
  return version;
}

async function applyRemoteSnapshot(db: Executor, accountId: string, item: SyncItem, snapshot: Record<string, unknown>): Promise<void> {
  const entity = item.entity_type;
  const table = entity === "pet" ? "pets" : domainTables[entity];
  if (!table) throw new Error("Este tipo de conflicto no se puede resolver desde la aplicación.");
  const fields = entity === "pet" ? petFields : domainFields[entity];
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${table} WHERE owner_id=? AND id=?`, accountId, item.entity_id);
  if (!row) throw new Error("El registro local ya no existe; actualiza el estado y vuelve a intentarlo.");
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of [...fields, "created_at", "updated_at", "deleted_at"]) {
    const column = localColumns[entity]?.[field] ?? field;
    assignments.push(`${column}=?`);
    values.push(toLocal(entity, field, snapshot[field]) as string | number | null);
  }
  const version = remoteVersion(snapshot, item.server_version ?? 0);
  assignments.push("version=?", "server_version=?", "acknowledged_local_revision=local_revision");
  values.push(version, version, accountId, item.entity_id);
  await db.runAsync(`UPDATE ${table} SET ${assignments.join(",")} WHERE owner_id=? AND id=?`, ...values);
}

export async function resolveConflictForAccount(
  db: Executor,
  accountId: string,
  conflictId: string,
  choice: SyncChoice,
  createOperationId: () => string,
): Promise<void> {
  const item = await db.getFirstAsync<SyncItem & { account_id: string }>(
    `SELECT q.operation_id,q.account_id,q.entity_type,q.entity_id,q.action,q.status,q.attempt_count,q.next_retry_at,
      q.last_error,q.local_revision,q.base_version,c.id AS conflict_id,c.server_version,c.local_snapshot,
      c.server_snapshot,c.conflicting_fields,
      (SELECT count(*) FROM sync_queue_dependencies d WHERE d.account_id=q.account_id AND d.depends_on_operation_id=q.operation_id) AS dependent_count,
      (SELECT count(DISTINCT d.operation_id) FROM sync_queue_dependencies d JOIN sync_queue parent ON parent.account_id=d.account_id AND parent.operation_id=d.depends_on_operation_id JOIN sync_queue child ON child.account_id=d.account_id AND child.operation_id=d.operation_id WHERE d.account_id=q.account_id AND parent.entity_type=q.entity_type AND parent.entity_id=q.entity_id AND (child.entity_type<>q.entity_type OR child.entity_id<>q.entity_id)) AS external_dependent_count
     FROM sync_conflicts c JOIN sync_queue q ON q.account_id=c.account_id AND q.operation_id=c.operation_id
     WHERE c.account_id=? AND c.id=? AND c.status='open'`, accountId, conflictId,
  );
  if (!item) throw new Error("El conflicto ya se resolvió o no pertenece a esta cuenta.");
  const table = item.entity_type === "pet" ? "pets" : domainTables[item.entity_type];
  const fields = item.entity_type === "pet" ? petFields : domainFields[item.entity_type];
  if (!table || !fields) throw new Error("Este tipo de conflicto requiere atención y no se puede resolver desde la aplicación.");
  const server = JSON.parse(item.server_snapshot ?? "{}") as Record<string, unknown>;
  const remoteDeleted = Boolean(server.deleted_at);
  const local = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE owner_id=? AND id=?`, accountId, item.entity_id,
  );
  if (!local) throw new Error("El registro local ya no existe; no se modificó la cola.");

  if (choice === "local" && remoteDeleted && !local.deleted_at) {
    throw new Error("El servidor eliminó este registro. La versión local se conserva, pero el protocolo actual no permite restaurar una versión sobre un tombstone.");
  }
  if (choice === "remote") {
    const chain = await getActiveEntityChain(db, accountId, item.entity_type, item.entity_id);
    await applyRemoteSnapshot(db, accountId, item, server);
    await retireEntityChain(db, accountId, chain, "CONFLICT_RESOLVED_REMOTE", JSON.stringify({ choice: "remote" }));
    await clearEntityChainDependencies(db, accountId, chain);
    await db.runAsync(
      "UPDATE sync_queue SET status='pending',next_retry_at=NULL,updated_at=? WHERE account_id=? AND status='blocked' AND NOT EXISTS(SELECT 1 FROM sync_queue_dependencies d WHERE d.account_id=sync_queue.account_id AND d.operation_id=sync_queue.operation_id)",
      new Date().toISOString(), accountId,
    );
  } else {
    const serverVer = remoteVersion(server, item.server_version ?? 0);
    if (remoteDeleted && local.deleted_at) {
      await applyRemoteSnapshot(db, accountId, item, server);
      const chain = await getActiveEntityChain(db, accountId, item.entity_type, item.entity_id);
      await retireEntityChain(db, accountId, chain, "CONFLICT_RESOLVED_REMOTE", JSON.stringify({ choice: "local-equivalent-to-remote" }));
      await clearEntityChainDependencies(db, accountId, chain);
      return;
    }
    const localPayload = fromLocal(item.entity_type, local);
    const differences = fields.filter((field) => normalize(localPayload[field]) !== normalize(server[field]));
    if (local.deleted_at && !remoteDeleted) differences.push("deleted_at");
    if (differences.length === 0) {
      await applyRemoteSnapshot(db, accountId, item, server);
      const chain = await getActiveEntityChain(db, accountId, item.entity_type, item.entity_id);
      await retireEntityChain(db, accountId, chain, "CONFLICT_RESOLVED_REMOTE", JSON.stringify({ choice: "identical" }));
      await clearEntityChainDependencies(db, accountId, chain);
      return;
    }
    const operationId = createOperationId().toLowerCase();
    const now = new Date().toISOString();
    const chain = await getActiveEntityChain(db, accountId, item.entity_type, item.entity_id);
    const localRevision = Number(local.local_revision ?? 0) + 1;
    const action = local.deleted_at ? "delete" : "update";
    localPayload.updated_at = now;
    if (action === "delete") localPayload.deleted_at = local.deleted_at;
    await db.runAsync(`UPDATE ${table} SET local_revision=?,version=?,server_version=?,updated_at=? WHERE owner_id=? AND id=?`, localRevision, serverVer, serverVer, now, accountId, item.entity_id);
    await db.runAsync(
      `INSERT INTO sync_queue(operation_id,account_id,entity_type,entity_id,action,payload,base_version,changed_fields,status,attempt_count,next_retry_at,last_error,created_at,updated_at,local_revision)
       VALUES(?,?,?,?,?,?,?,?, 'pending',0,NULL,NULL,?,?,?)`,
      operationId, accountId, item.entity_type, item.entity_id, action, JSON.stringify(localPayload), serverVer,
      JSON.stringify(differences), now, now, localRevision,
    );
    await connectReplacement(db, accountId, chain, operationId);
    await db.runAsync(
      "UPDATE sync_queue SET status='pending',next_retry_at=NULL,updated_at=? WHERE account_id=? AND status='blocked' AND NOT EXISTS(SELECT 1 FROM sync_queue_dependencies d WHERE d.account_id=sync_queue.account_id AND d.operation_id=sync_queue.operation_id)",
      now, accountId,
    );
    await retireEntityChain(db, accountId, chain, "CONFLICT_SUPERSEDED_BY_RESOLUTION", JSON.stringify({ choice: "local", replacement_operation_id: operationId }));
    return;
  }

  await db.runAsync(
    "UPDATE sync_conflicts SET status='resolved',resolution=?,resolved_at=? WHERE account_id=? AND id=? AND status='open'",
    JSON.stringify({ choice }), new Date().toISOString(), accountId, conflictId,
  );
}

async function getActiveEntityChain(db: Executor, accountId: string, entity: string, entityId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ operation_id: string }>(
    "SELECT operation_id FROM sync_queue WHERE account_id=? AND entity_type=? AND entity_id=? AND status IN ('pending','in_flight','blocked','conflict','failed') ORDER BY rowid",
    accountId, entity, entityId,
  );
  return [...new Set(rows.map((row) => row.operation_id))];
}

async function connectReplacement(db: Executor, accountId: string, chain: string[], replacementId: string): Promise<void> {
  const chainSet = new Set(chain);
  const prerequisites = new Set<string>();
  const dependants = new Set<string>();
  for (const operation of chain) {
    const upstream = await db.getAllAsync<{ depends_on_operation_id: string }>(
      "SELECT depends_on_operation_id FROM sync_queue_dependencies WHERE account_id=? AND operation_id=?", accountId, operation,
    );
    for (const edge of upstream) if (!chainSet.has(edge.depends_on_operation_id)) prerequisites.add(edge.depends_on_operation_id);
    const downstream = await db.getAllAsync<{ operation_id: string }>(
      "SELECT operation_id FROM sync_queue_dependencies WHERE account_id=? AND depends_on_operation_id=?", accountId, operation,
    );
    for (const edge of downstream) if (!chainSet.has(edge.operation_id)) dependants.add(edge.operation_id);
  }
  for (const prerequisite of prerequisites) await db.runAsync(
    "INSERT OR IGNORE INTO sync_queue_dependencies(account_id,operation_id,depends_on_operation_id) VALUES(?,?,?)", accountId, replacementId, prerequisite,
  );
  for (const dependant of dependants) await db.runAsync(
    "INSERT OR IGNORE INTO sync_queue_dependencies(account_id,operation_id,depends_on_operation_id) VALUES(?,?,?)", accountId, dependant, replacementId,
  );
  for (const operation of chain) {
    await db.runAsync("DELETE FROM sync_queue_dependencies WHERE account_id=? AND operation_id=?", accountId, operation);
    await db.runAsync("DELETE FROM sync_queue_dependencies WHERE account_id=? AND depends_on_operation_id=?", accountId, operation);
  }
}

async function retireEntityChain(db: Executor, accountId: string, chain: string[], errorCode: string, resolution: string): Promise<void> {
  const now = new Date().toISOString();
  for (const operation of chain) {
    await db.runAsync("UPDATE sync_queue SET status='failed',last_error=?,next_retry_at=NULL,updated_at=? WHERE account_id=? AND operation_id=?", errorCode, now, accountId, operation);
    await db.runAsync("UPDATE sync_conflicts SET status='resolved',resolution=?,resolved_at=? WHERE account_id=? AND operation_id=? AND status='open'", resolution, now, accountId, operation);
  }
}

async function clearEntityChainDependencies(db: Executor, accountId: string, chain: string[]): Promise<void> {
  for (const operation of chain) {
    await db.runAsync("DELETE FROM sync_queue_dependencies WHERE account_id=? AND operation_id=?", accountId, operation);
    await db.runAsync("DELETE FROM sync_queue_dependencies WHERE account_id=? AND depends_on_operation_id=?", accountId, operation);
  }
}

