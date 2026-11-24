import * as Crypto from "expo-crypto";
import { AppState, Platform } from "react-native";
import { getPetCareDatabase } from "../../db/database";
import { getActiveLocalAuthUserId, getLocalAccountId, withLocalWriteTransaction } from "../../db/localAccount";
import { apiClient } from "../auth/apiClient";
import { retryDelayMilliseconds } from "./petSyncPolicy";
import { synchronizeDomainEntities } from "./domainSync";
import { synchronizeMedia } from "./mediaSync";

const PROTOCOL_VERSION = 1;
const SQLITE_SCHEMA_VERSION = 10;
const PUSH_BATCH_SIZE = 50;
const PULL_PAGE_SIZE = 200;

interface QueueRow {
  operation_id: string;
  entity_id: string;
  action: "create" | "update" | "delete";
  payload: string;
  base_version: number;
  local_revision: number;
  changed_fields: string;
  attempt_count: number;
}

interface PetSyncResult {
  operation_id: string;
  entity_type: "pet";
  entity_id: string;
  status: "applied" | "already_applied" | "conflict" | "rejected" | "dependency_blocked";
  server_version?: number;
  server_updated_at?: string;
  cursor?: string;
  request_hash?: string;
  server_snapshot?: Record<string, unknown> | null;
  code?: string;
  message?: string;
}

interface PetChange {
  cursor: string;
  entity_type: "pet";
  entity_version: number;
  change_type: "upsert" | "delete";
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: "female" | "male" | "unknown" | null;
  birth_date: string | null;
  approximate_age_months: number | null;
  weight_kg: number | null;
  color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

let syncInFlight: Promise<void> | undefined;

function ensureSameAccount(authUserId: string, localAccountId: string): void {
  if (getActiveLocalAuthUserId() !== authUserId) throw new Error("Active account changed during pet synchronization.");
  void localAccountId;
}

async function getDeviceId(localAccountId: string): Promise<string> {
  const db = await getPetCareDatabase();
  const existing = await db.getFirstAsync<{ device_id: string | null }>(
    "SELECT device_id FROM sync_metadata WHERE account_id = ?",
    localAccountId,
  );
  if (existing?.device_id) return existing.device_id;
  const deviceId = Crypto.randomUUID().toLowerCase();
  await db.runAsync("UPDATE sync_metadata SET device_id = ?, updated_at = ? WHERE account_id = ?", deviceId, new Date().toISOString(), localAccountId);
  return deviceId;
}

async function registerDevice(deviceId: string): Promise<void> {
  await apiClient.request(`/sync/v1/devices/${deviceId}`, {
    method: "PUT",
    authenticated: true,
    body: { platform: Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web" ? Platform.OS : "other", app_version: "1.0.0", schema_version: SQLITE_SCHEMA_VERSION },
  });
}

function sanitizePetPayload(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw) as Record<string, unknown>;
  const fields = ["id", "name", "species", "breed", "sex", "birth_date", "approximate_age_months", "weight_kg", "color", "notes", "created_at", "updated_at", "deleted_at"];
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]));
}

async function selectReadyOperations(localAccountId: string): Promise<Array<QueueRow & { depends_on: string[] }>> {
  const db = await getPetCareDatabase();
  const now = new Date().toISOString();
  const candidates = await db.getAllAsync<QueueRow>(
    `SELECT operation_id, entity_id, action, payload, base_version, local_revision,
            changed_fields, attempt_count
     FROM sync_queue
     WHERE account_id = ? AND entity_type = 'pet' AND status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at, rowid LIMIT 500`,
    localAccountId,
    now,
  );
  const dependencies = await db.getAllAsync<{ operation_id: string; depends_on_operation_id: string }>(
    `SELECT operation_id, depends_on_operation_id FROM sync_queue_dependencies WHERE account_id = ?`,
    localAccountId,
  );
  const byOperation = new Map(candidates.map((operation) => [operation.operation_id, operation]));
  const depsByOperation = new Map<string, string[]>();
  for (const edge of dependencies) depsByOperation.set(edge.operation_id, [...(depsByOperation.get(edge.operation_id) ?? []), edge.depends_on_operation_id]);
  const selected = new Set<string>();
  const output: Array<QueueRow & { depends_on: string[] }> = [];
  let progressed = true;
  while (progressed && output.length < PUSH_BATCH_SIZE) {
    progressed = false;
    for (const operation of candidates) {
      if (selected.has(operation.operation_id)) continue;
      const deps = depsByOperation.get(operation.operation_id) ?? [];
      const ready = deps.every((dependencyId) => {
        if (selected.has(dependencyId)) return true;
        return !byOperation.has(dependencyId);
      });
      if (!ready) continue;
      selected.add(operation.operation_id);
      output.push({ ...operation, depends_on: deps });
      progressed = true;
      if (output.length >= PUSH_BATCH_SIZE) break;
    }
  }
  return output;
}

async function markInFlight(localAccountId: string, operations: QueueRow[]): Promise<void> {
  const db = await getPetCareDatabase();
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    for (const operation of operations) {
      await db.runAsync(
        "UPDATE sync_queue SET status = 'in_flight', updated_at = ? WHERE account_id = ? AND operation_id = ? AND status = 'pending'",
        new Date().toISOString(), localAccountId, operation.operation_id,
      );
    }
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK");
    throw error;
  }
}

async function applyPushResults(authUserId: string, localAccountId: string, results: PetSyncResult[]): Promise<void> {
  await withLocalWriteTransaction(async (tx, ownerId) => {
    ensureSameAccount(authUserId, localAccountId);
    if (ownerId !== localAccountId) throw new Error("Local account changed during synchronization.");
    for (const result of results) {
      if (result.status === "applied" || result.status === "already_applied") {
        if (!Number.isSafeInteger(result.server_version) || !result.cursor) throw new Error("The sync acknowledgement is incomplete.");
        const queued = await tx.getFirstAsync<{ local_revision: number }>(
          "SELECT local_revision FROM sync_queue WHERE account_id = ? AND operation_id = ?",
          ownerId, result.operation_id,
        );
        if (!queued) continue;
        await tx.runAsync(
          `UPDATE pets SET server_version = ?, version = ?,
             acknowledged_local_revision = max(acknowledged_local_revision, ?)
           WHERE owner_id = ? AND id = ?`,
          result.server_version!, result.server_version!, queued.local_revision, ownerId, result.entity_id,
        );
        await tx.runAsync("DELETE FROM sync_queue_dependencies WHERE account_id = ? AND depends_on_operation_id = ?", ownerId, result.operation_id);
        await tx.runAsync("DELETE FROM sync_queue WHERE account_id = ? AND operation_id = ?", ownerId, result.operation_id);
        await tx.runAsync(
          `UPDATE sync_queue SET status = 'pending', next_retry_at = NULL, updated_at = ?
           WHERE account_id = ? AND status = 'blocked'
             AND NOT EXISTS (SELECT 1 FROM sync_queue_dependencies d WHERE d.account_id = sync_queue.account_id AND d.operation_id = sync_queue.operation_id)`,
          new Date().toISOString(), ownerId,
        );
      } else if (result.status === "conflict" && result.server_snapshot) {
        const local = await tx.getFirstAsync<Record<string, unknown>>("SELECT * FROM pets WHERE owner_id = ? AND id = ?", ownerId, result.entity_id);
        const queued = await tx.getFirstAsync<{ operation_id: string; base_version: number; changed_fields: string; payload: string }>(
          "SELECT operation_id, base_version, changed_fields, payload FROM sync_queue WHERE account_id = ? AND operation_id = ?",
          ownerId, result.operation_id,
        );
        if (local && queued && Number.isSafeInteger(result.server_version)) {
          await tx.runAsync("UPDATE sync_queue SET status = 'conflict', last_error = ?, updated_at = ? WHERE account_id = ? AND operation_id = ?", result.code ?? "VERSION_CONFLICT", new Date().toISOString(), ownerId, result.operation_id);
          await tx.runAsync(
            `INSERT OR IGNORE INTO sync_conflicts
            (id, account_id, operation_id, entity_type, entity_id, base_version,
             server_version, local_snapshot, server_snapshot, conflicting_fields, created_at)
             VALUES (?, ?, ?, 'pet', ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, operation_id) DO UPDATE SET
               server_version=excluded.server_version, server_snapshot=excluded.server_snapshot,
               conflicting_fields=excluded.conflicting_fields`,
            Crypto.randomUUID().toLowerCase(), ownerId, result.operation_id, result.entity_id,
            queued.base_version, result.server_version!, JSON.stringify(local),
            JSON.stringify(result.server_snapshot), queued.changed_fields, new Date().toISOString(),
          );
        }
      } else if (result.status === "rejected" || result.status === "dependency_blocked") {
        await tx.runAsync(
          "UPDATE sync_queue SET status = ?, last_error = ?, updated_at = ? WHERE account_id = ? AND operation_id = ?",
          result.status === "rejected" ? "failed" : "blocked", result.code ?? result.status,
          new Date().toISOString(), ownerId, result.operation_id,
        );
      }
    }
  });
}

function cursorNumber(cursor: string): number {
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("The sync cursor is outside the supported integer range.");
  return value;
}

async function applyPullPage(authUserId: string, localAccountId: string, changes: PetChange[], nextCursor: string): Promise<void> {
  await withLocalWriteTransaction(async (tx, ownerId) => {
    ensureSameAccount(authUserId, localAccountId);
    if (ownerId !== localAccountId) throw new Error("Local account changed during synchronization.");
    for (const change of changes) {
      const existing = await tx.getFirstAsync<Record<string, unknown> & { owner_id: string; server_version: number }>("SELECT * FROM pets WHERE id = ?", change.id);
      if (existing && existing.owner_id !== ownerId) throw new Error("A local pet identifier collides with another account's data; pull was rolled back.");
      const pending = await tx.getFirstAsync<{ operation_id: string; base_version: number; changed_fields: string }>(
        `SELECT operation_id, base_version, changed_fields FROM sync_queue
         WHERE account_id = ? AND entity_type = 'pet' AND entity_id = ?
           AND status IN ('pending','in_flight','blocked','conflict','failed')
         ORDER BY rowid LIMIT 1`,
        ownerId, change.id,
      );
      if (!existing) {
        await tx.runAsync(
          `INSERT INTO pets (id, owner_id, name, species, breed, sex, birth_date,
             approximate_age_months, weight_kg, color, notes, photo_storage_key,
             version, local_revision, server_version, acknowledged_local_revision,
             created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, 0, ?, ?, ?)`,
          change.id, ownerId, change.name, change.species, change.breed, change.sex,
          change.birth_date, change.approximate_age_months, change.weight_kg,
          change.color, change.notes, change.entity_version, change.entity_version,
          change.created_at, change.updated_at, change.deleted_at,
        );
        continue;
      }
      if (change.entity_version <= existing.server_version) continue;
      if (pending) {
        await tx.runAsync("UPDATE sync_queue SET status = 'conflict', last_error = 'REMOTE_CHANGE', updated_at = ? WHERE account_id = ? AND operation_id = ?", new Date().toISOString(), ownerId, pending.operation_id);
        await tx.runAsync(
          `INSERT OR IGNORE INTO sync_conflicts
            (id, account_id, operation_id, entity_type, entity_id, base_version,
             server_version, local_snapshot, server_snapshot, conflicting_fields, created_at)
           VALUES (?, ?, ?, 'pet', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, operation_id) DO UPDATE SET
             server_version=excluded.server_version, server_snapshot=excluded.server_snapshot,
             conflicting_fields=excluded.conflicting_fields`,
          Crypto.randomUUID().toLowerCase(), ownerId, pending.operation_id, change.id,
          pending.base_version, change.entity_version, JSON.stringify(existing),
          JSON.stringify(change), pending.changed_fields, new Date().toISOString(),
        );
        continue;
      }
      await tx.runAsync(
        `UPDATE pets SET name=?,species=?,breed=?,sex=?,birth_date=?,
           approximate_age_months=?,weight_kg=?,color=?,notes=?,version=?,
           server_version=?,acknowledged_local_revision=local_revision,
           created_at=?,updated_at=?,deleted_at=?
         WHERE owner_id=? AND id=?`,
        change.name, change.species, change.breed, change.sex, change.birth_date,
        change.approximate_age_months, change.weight_kg, change.color, change.notes,
        change.entity_version, change.entity_version, change.created_at,
        change.updated_at, change.deleted_at, ownerId, change.id,
      );
    }
    await tx.runAsync(
      `UPDATE sync_metadata SET last_download_cursor = ?, last_successful_sync_at = ?, updated_at = ?
       WHERE account_id = ?`,
      cursorNumber(nextCursor), new Date().toISOString(), new Date().toISOString(), ownerId,
    );
  });
}

async function retryBatch(localAccountId: string, operations: QueueRow[]): Promise<void> {
  const db = await getPetCareDatabase();
  for (const operation of operations) {
    const attempt = operation.attempt_count + 1;
    const retryAt = new Date(Date.now() + retryDelayMilliseconds(attempt)).toISOString();
    await db.runAsync(
      `UPDATE sync_queue SET status='pending',attempt_count=?,next_retry_at=?,
         last_error='NETWORK_OR_SERVER_UNAVAILABLE',updated_at=?
       WHERE account_id=? AND operation_id=? AND status='in_flight'`,
      attempt, retryAt, new Date().toISOString(), localAccountId, operation.operation_id,
    );
  }
}

async function runPetSync(): Promise<void> {
  const authUserId = getActiveLocalAuthUserId();
  if (!authUserId) return;
  const localAccountId = await getLocalAccountId();
  ensureSameAccount(authUserId, localAccountId);
  const deviceId = await getDeviceId(localAccountId);
  await registerDevice(deviceId);

  const operations = await selectReadyOperations(localAccountId);
  if (operations.length) {
    await markInFlight(localAccountId, operations);
    try {
      ensureSameAccount(authUserId, localAccountId);
      const response = await apiClient.request<{ results: PetSyncResult[] }>("/sync/v1/push", {
        method: "POST", authenticated: true,
        body: {
          protocol_version: PROTOCOL_VERSION,
          device_id: deviceId,
          batch_id: Crypto.randomUUID().toLowerCase(),
          operations: operations.map((operation) => ({
            operation_id: operation.operation_id,
            entity_type: "pet",
            entity_id: operation.entity_id,
            action: operation.action,
            base_version: operation.base_version,
            local_revision: operation.local_revision,
            depends_on: [...operation.depends_on].sort(),
            changed_fields: JSON.parse(operation.changed_fields).filter((field: string) => field !== "photo_storage_key").sort(),
            payload: sanitizePetPayload(operation.payload),
          })),
        },
      });
      await applyPushResults(authUserId, localAccountId, response.results);
      const received = new Set(response.results.map((result) => result.operation_id));
      const missing = operations.filter((operation) => !received.has(operation.operation_id));
      if (missing.length) await retryBatch(localAccountId, missing);
    } catch (error) {
      await retryBatch(localAccountId, operations);
      throw error;
    }
  }

  let cursor = await (await getPetCareDatabase()).getFirstAsync<{ last_download_cursor: number }>("SELECT last_download_cursor FROM sync_metadata WHERE account_id = ?", localAccountId);
  let after = cursor?.last_download_cursor ?? 0;
  for (let page = 0; page < 100; page += 1) {
    ensureSameAccount(authUserId, localAccountId);
    const pulled = await apiClient.request<{ changes: PetChange[]; next_cursor: string; has_more: boolean }>("/sync/v1/pull", {
      method: "POST", authenticated: true,
      body: { device_id: deviceId, after_cursor: String(after), limit: PULL_PAGE_SIZE },
    });
    await applyPullPage(authUserId, localAccountId, pulled.changes, pulled.next_cursor);
    after = cursorNumber(pulled.next_cursor);
    if (!pulled.has_more) break;
  }
  const lastCursor = await (await getPetCareDatabase()).getFirstAsync<{ last_download_cursor: number }>("SELECT last_download_cursor FROM sync_metadata WHERE account_id = ?", localAccountId);
  await apiClient.request("/sync/v1/ack", { method: "POST", authenticated: true, body: { device_id: deviceId, cursor: String(lastCursor?.last_download_cursor ?? 0) } });
  await synchronizeDomainEntities(deviceId, authUserId, localAccountId);
  await synchronizeMedia();
}

export function synchronizePets(): Promise<void> {
  if (!syncInFlight) {
    syncInFlight = runPetSync().finally(() => { syncInFlight = undefined; });
  }
  return syncInFlight;
}

export async function waitForPetSync(): Promise<void> {
  await syncInFlight?.catch(() => undefined);
}

export function subscribeToAppForegroundSync(): { remove(): void } {
  let interval: ReturnType<typeof setInterval> | undefined;
  const stopPolling = () => {
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
  };
  const startPolling = () => {
    stopPolling();
    if (!getActiveLocalAuthUserId()) return;
    void synchronizePets().catch(() => undefined);
    // Retry while the app stays open after connectivity returns, and pull
    // changes made by another device without requiring a manual refresh.
    interval = setInterval(() => {
      if (getActiveLocalAuthUserId()) void synchronizePets().catch(() => undefined);
    }, 60_000);
  };
  if (AppState.currentState === "active") startPolling();
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") startPolling();
    else stopPolling();
  });
  return {
    remove() {
      stopPolling();
      subscription.remove();
    },
  };
}
