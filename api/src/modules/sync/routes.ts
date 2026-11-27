import { createHash } from "node:crypto";
import { Router } from "express";
import type { QueryResultRow } from "pg";
import { createAuthenticateMiddleware, requirePrincipal } from "../auth/middleware/authenticate.js";
import type { AuthStore } from "../auth/types.js";
import { InvalidPetRequestError } from "../pets/errors.js";
import { validateCreatePet, validatePetId } from "../pets/validation.js";
import type { PetSyncOperation, PetSyncPayload, PetSyncChange, SyncClient, SyncOperationResult, SyncPool, SyncQueryable } from "./types.js";

const PET_FIELDS = ["name", "species", "breed", "sex", "birth_date", "approximate_age_months", "weight_kg", "color", "notes"] as const;
const PAYLOAD_FIELDS = new Set(["id", ...PET_FIELDS, "created_at", "updated_at", "deleted_at"]);
const CHANGED_FIELDS = new Set(["name", "species", "breed", "sex", "birth_date", "approximate_age_months", "weight_kg", "color", "notes", "deleted_at"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH_SIZE = 50;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_PULL_SIZE = 500;

class SyncRequestError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) {
    super(message);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncRequestError("INVALID_REQUEST", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new SyncRequestError("INVALID_REQUEST", `${label} contains an unsupported field.`);
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new SyncRequestError("INVALID_REQUEST", `${label} must be a UUID.`);
  return value.toLowerCase();
}

function isoDate(value: unknown, label: string, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new SyncRequestError("INVALID_REQUEST", `${label} must be an ISO UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new SyncRequestError("INVALID_REQUEST", `${label} must be an ISO UTC timestamp.`);
  return value;
}

function normalizePayload(value: unknown, entityId: string, action: PetSyncOperation["action"]): PetSyncPayload {
  const input = record(value, "payload");
  exactKeys(input, [...PAYLOAD_FIELDS], "payload");
  if (uuid(input.id, "payload.id") !== entityId) throw new SyncRequestError("INVALID_REQUEST", "payload.id must match entity_id.");
  const camel: Record<string, unknown> = {
    name: input.name,
    species: input.species,
    breed: input.breed,
    sex: input.sex,
    birthDate: input.birth_date,
    approximateAgeMonths: input.approximate_age_months,
    weightKg: input.weight_kg,
    color: input.color,
    notes: input.notes,
  };
  let fields;
  try { fields = validateCreatePet(camel); }
  catch (error) {
    if (error instanceof InvalidPetRequestError) throw new SyncRequestError("INVALID_PET", error.message);
    throw error;
  }
  const createdAt = isoDate(input.created_at, "payload.created_at", false)!;
  const updatedAt = isoDate(input.updated_at, "payload.updated_at", false)!;
  const deletedAt = isoDate(input.deleted_at, "payload.deleted_at", true);
  if (action === "delete" && deletedAt === null) throw new SyncRequestError("INVALID_REQUEST", "A delete operation must include its local tombstone timestamp.");
  if (action !== "delete" && deletedAt !== null) throw new SyncRequestError("INVALID_REQUEST", "Only delete operations may include a tombstone.");
  return {
    id: entityId,
    name: fields.name,
    species: fields.species,
    breed: fields.breed ?? null,
    sex: fields.sex ?? null,
    birth_date: fields.birthDate ?? null,
    approximate_age_months: fields.approximateAgeMonths ?? null,
    weight_kg: fields.weightKg ?? null,
    color: fields.color ?? null,
    notes: fields.notes ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: deletedAt,
  };
}

function normalizeOperation(value: unknown): PetSyncOperation {
  const input = record(value, "operation");
  exactKeys(input, ["operation_id", "entity_type", "entity_id", "action", "base_version", "local_revision", "depends_on", "changed_fields", "payload"], "operation");
  const operationId = uuid(input.operation_id, "operation_id");
  const entityId = uuid(input.entity_id, "entity_id");
  if (input.entity_type !== "pet") throw new SyncRequestError("UNSUPPORTED_ENTITY", "Only pet operations are supported by sync protocol v1.");
  if (input.action !== "create" && input.action !== "update" && input.action !== "delete") throw new SyncRequestError("INVALID_REQUEST", "Unsupported operation action.");
  if (!Number.isSafeInteger(input.base_version) || (input.base_version as number) < 0 || !Number.isSafeInteger(input.local_revision) || (input.local_revision as number) < 1) throw new SyncRequestError("INVALID_REQUEST", "Operation versions are invalid.");
  if (input.action === "create" && input.base_version !== 0 || input.action !== "create" && (input.base_version as number) < 1) throw new SyncRequestError("INVALID_REQUEST", "base_version does not match the operation action.");
  if (!Array.isArray(input.depends_on) || input.depends_on.length > MAX_BATCH_SIZE) throw new SyncRequestError("INVALID_REQUEST", "depends_on must be a bounded array.");
  const dependencies = input.depends_on.map((item) => uuid(item, "depends_on item"));
  if (new Set(dependencies).size !== dependencies.length || dependencies.includes(operationId)) throw new SyncRequestError("INVALID_REQUEST", "Operation dependencies must be unique and cannot include the operation itself.");
  if (!Array.isArray(input.changed_fields) || input.changed_fields.length > CHANGED_FIELDS.size) throw new SyncRequestError("INVALID_REQUEST", "changed_fields must be a bounded array.");
  const changedFields = input.changed_fields.map((item) => {
    if (typeof item !== "string" || !CHANGED_FIELDS.has(item)) throw new SyncRequestError("INVALID_REQUEST", "changed_fields contains an unsupported field.");
    return item;
  });
  if (new Set(changedFields).size !== changedFields.length) throw new SyncRequestError("INVALID_REQUEST", "changed_fields must not contain duplicates.");
  return {
    operation_id: operationId,
    entity_type: "pet",
    entity_id: entityId,
    action: input.action,
    base_version: input.base_version as number,
    local_revision: input.local_revision as number,
    depends_on: dependencies.sort(),
    changed_fields: changedFields.sort(),
    payload: normalizePayload(input.payload, entityId, input.action),
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function hashOperation(operation: PetSyncOperation): string {
  return createHash("sha256").update(canonical({ protocol_version: 1, ...operation })).digest("hex");
}

function toPetSnapshot(row: Record<string, unknown>): PetSyncPayload {
  const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
  return {
    id: String(row.id),
    name: String(row.name),
    species: String(row.species),
    breed: row.breed === null ? null : String(row.breed),
    sex: row.sex === null ? null : row.sex as PetSyncPayload["sex"],
    birth_date: row.birth_date === null ? null : typeof row.birth_date === "string" ? row.birth_date : date(row.birth_date).slice(0, 10),
    approximate_age_months: row.approximate_age_months === null ? null : Number(row.approximate_age_months),
    weight_kg: row.weight_kg === null ? null : Number(row.weight_kg),
    color: row.color === null ? null : String(row.color),
    notes: row.notes === null ? null : String(row.notes),
    // Photo keys refer to device-local bytes and are deliberately never sent.
    created_at: date(row.created_at),
    updated_at: date(row.updated_at),
    deleted_at: row.deleted_at === null ? null : date(row.deleted_at),
  };
}

const PET_SELECT = `id, owner_id, name, species, breed, sex, birth_date,
  approximate_age_months, weight_kg, color, notes, created_at, updated_at, deleted_at, version`;

function poolFrom(database: SyncQueryable): SyncPool | null {
  const value = database as SyncQueryable & Partial<SyncPool>;
  return typeof value.connect === "function" ? value as SyncPool : null;
}

async function registerDevice(database: SyncQueryable, userId: string, deviceId: string, body: Record<string, unknown>) {
  exactKeys(body, ["platform", "app_version", "schema_version"], "device");
  const platform = body.platform;
  if (!["ios", "android", "web", "other"].includes(String(platform))) throw new SyncRequestError("INVALID_DEVICE", "Unsupported client platform.");
  if (body.app_version !== undefined && (typeof body.app_version !== "string" || body.app_version.length > 40)) throw new SyncRequestError("INVALID_DEVICE", "app_version is invalid.");
  const schemaVersion = body.schema_version ?? 0;
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 0) throw new SyncRequestError("INVALID_DEVICE", "schema_version is invalid.");
  const result = await database.query<{ id: string } & QueryResultRow>(
    `INSERT INTO sync_devices (id, user_id, platform, app_version, schema_version)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET platform = EXCLUDED.platform,
       app_version = EXCLUDED.app_version, schema_version = EXCLUDED.schema_version,
       last_seen_at = now(), updated_at = now()
     WHERE sync_devices.user_id = EXCLUDED.user_id
     RETURNING id`,
    [deviceId, userId, platform, body.app_version ?? null, schemaVersion],
  );
  if (!result.rows.length) throw new SyncRequestError("DEVICE_OWNERSHIP_MISMATCH", "This device is registered to another account.", 409);
  return { device_id: deviceId, status: "active", registered_at: new Date().toISOString() };
}

async function processOperation(
  pool: SyncPool,
  userId: string,
  operation: PetSyncOperation,
  batchResults: Map<string, SyncOperationResult>,
): Promise<SyncOperationResult> {
  const requestHash = hashOperation(operation);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ request_hash: string; response: Record<string, unknown> } & QueryResultRow>(
      `INSERT INTO sync_operations (user_id, operation_id, request_hash, response)
       VALUES ($1, $2, $3, '{"status":"processing"}'::jsonb)
       ON CONFLICT (user_id, operation_id) DO NOTHING
       RETURNING request_hash, response`,
      [userId, operation.operation_id, requestHash],
    );
    let stored = inserted.rows[0];
    if (!stored) {
      const found = await client.query<{ request_hash: string; response: Record<string, unknown> } & QueryResultRow>(
        `SELECT request_hash, response FROM sync_operations
         WHERE user_id = $1 AND operation_id = $2 FOR UPDATE`,
        [userId, operation.operation_id],
      );
      stored = found.rows[0];
    }
    if (!stored) throw new Error("Could not obtain the idempotency receipt.");
    if (stored.request_hash.trim() !== requestHash) throw new SyncRequestError("OPERATION_ID_REUSED", "An operation identifier cannot be reused with different content.", 409);
    if (stored.response.status !== "processing") {
      const replay = stored.response as unknown as SyncOperationResult;
      await client.query("COMMIT");
      return replay;
    }

    for (const dependency of operation.depends_on) {
      const sameBatch = batchResults.get(dependency);
      if (sameBatch && !["applied", "already_applied"].includes(sameBatch.status)) {
        const result: SyncOperationResult = { operation_id: operation.operation_id, entity_type: "pet", entity_id: operation.entity_id, status: "dependency_blocked", code: "DEPENDENCY_NOT_APPLIED", message: "A prerequisite operation has not been accepted." };
        // A blocked operation is not terminal: keep its operation_id/hash
        // reusable after the prerequisite is acknowledged.
        await client.query("ROLLBACK");
        return result;
      }
      const dep = await client.query<{ response: Record<string, unknown> } & QueryResultRow>(
        "SELECT response FROM sync_operations WHERE user_id = $1 AND operation_id = $2",
        [userId, dependency],
      );
      if (!dep.rows[0] || !["applied", "already_applied"].includes(String(dep.rows[0].response.status))) {
        const result: SyncOperationResult = { operation_id: operation.operation_id, entity_type: "pet", entity_id: operation.entity_id, status: "dependency_blocked", code: "DEPENDENCY_NOT_APPLIED", message: "A prerequisite operation has not been accepted." };
        await client.query("ROLLBACK");
        return result;
      }
    }

    await client.query("SELECT set_config('petcare.sync_operation_id', $1, true)", [operation.operation_id]);
    await client.query("SELECT set_config('petcare.sync_changed_fields', $1, true)", [JSON.stringify(operation.changed_fields)]);
    let row: Record<string, unknown> | undefined;
    let result: SyncOperationResult;
    const fields = operation.payload;
    if (operation.action === "create") {
      const existing = await client.query<Record<string, unknown> & QueryResultRow>(`SELECT ${PET_SELECT} FROM pets WHERE id = $1`, [operation.entity_id]);
      if (existing.rows[0]) {
        const own = String(existing.rows[0].owner_id) === userId;
        result = {
          operation_id: operation.operation_id,
          entity_type: "pet",
          entity_id: operation.entity_id,
          status: own ? "conflict" : "rejected",
          code: own ? "ENTITY_ALREADY_EXISTS" : "IDENTITY_COLLISION",
          message: own ? "The pet already exists and must be reconciled." : "The pet identifier is unavailable.",
          ...(own ? { server_version: Number(existing.rows[0].version), server_snapshot: toPetSnapshot(existing.rows[0]) } : {}),
        };
      } else {
        const created = await client.query<Record<string, unknown> & QueryResultRow>(
          `INSERT INTO pets (id, owner_id, name, species, breed, sex, birth_date,
             approximate_age_months, weight_kg, color, notes, photo_storage_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)
           RETURNING ${PET_SELECT}`,
          [operation.entity_id, userId, fields.name, fields.species, fields.breed, fields.sex, fields.birth_date, fields.approximate_age_months, fields.weight_kg, fields.color, fields.notes],
        );
        row = created.rows[0];
      }
    } else {
      const values = [userId, operation.entity_id, operation.base_version, fields.name, fields.species, fields.breed, fields.sex, fields.birth_date, fields.approximate_age_months, fields.weight_kg, fields.color, fields.notes];
      const changed = operation.action === "update"
        ? await client.query<Record<string, unknown> & QueryResultRow>(
          `UPDATE pets SET name=$4,species=$5,breed=$6,sex=$7,birth_date=$8,
             approximate_age_months=$9,weight_kg=$10,color=$11,notes=$12,
             version=version+1,updated_at=now()
           WHERE owner_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL
           RETURNING ${PET_SELECT}`,
          values,
        )
        : await client.query<Record<string, unknown> & QueryResultRow>(
          `UPDATE pets SET deleted_at=now(),version=version+1,updated_at=now()
           WHERE owner_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL
           RETURNING ${PET_SELECT}`,
          values.slice(0, 3),
        );
      row = changed.rows[0];
      if (!row) {
        const current = await client.query<Record<string, unknown> & QueryResultRow>(`SELECT ${PET_SELECT} FROM pets WHERE owner_id=$1 AND id=$2`, [userId, operation.entity_id]);
        if (current.rows[0]) {
          result = { operation_id: operation.operation_id, entity_type: "pet", entity_id: operation.entity_id, status: "conflict", server_version: Number(current.rows[0].version), code: "VERSION_CONFLICT", message: "The pet changed on another device.", server_snapshot: toPetSnapshot(current.rows[0]) };
        } else {
          result = { operation_id: operation.operation_id, entity_type: "pet", entity_id: operation.entity_id, status: "rejected", code: "PET_NOT_FOUND", message: "The pet is unavailable." };
        }
      }
    }

    if (row) {
      const feed = await client.query<{ cursor: string } & QueryResultRow>(
        "SELECT cursor::text AS cursor FROM sync_changes WHERE owner_id=$1 AND operation_id=$2 ORDER BY cursor DESC LIMIT 1",
        [userId, operation.operation_id],
      );
      result = {
        operation_id: operation.operation_id,
        entity_type: "pet",
        entity_id: operation.entity_id,
        status: "applied",
        server_version: Number(row.version),
        server_updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        cursor: feed.rows[0]?.cursor,
        request_hash: requestHash,
      };
    }
    await client.query("UPDATE sync_operations SET response = $3::jsonb WHERE user_id = $1 AND operation_id = $2", [userId, operation.operation_id, JSON.stringify(result!)]);
    await client.query("COMMIT");
    return result!;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function parseCursor(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new SyncRequestError("INVALID_CURSOR", `${label} must be a decimal string.`);
  try { return BigInt(value); } catch { throw new SyncRequestError("INVALID_CURSOR", `${label} is invalid.`); }
}

export function createSyncRouter(database: SyncQueryable, authStore: AuthStore, accessTokenSecret: Uint8Array): Router {
  const router = Router();
  router.use(createAuthenticateMiddleware(authStore, accessTokenSecret));

  router.put("/devices/:deviceId", async (request, response) => {
    try {
      const deviceId = uuid(request.params.deviceId, "deviceId");
      const result = await registerDevice(database, requirePrincipal(request).userId, deviceId, record(request.body, "device"));
      response.status(200).json(result);
    } catch (error) { sendError(response, error); }
  });

  router.post("/push", async (request, response) => {
    try {
      if (Buffer.byteLength(JSON.stringify(request.body), "utf8") > MAX_BODY_BYTES) throw new SyncRequestError("BATCH_TOO_LARGE", "The sync batch exceeds the maximum size.", 413);
      const body = record(request.body, "request");
      exactKeys(body, ["protocol_version", "device_id", "batch_id", "operations"], "request");
      if (body.protocol_version !== 1) throw new SyncRequestError("PROTOCOL_VERSION_UNSUPPORTED", "The sync protocol version is not supported.", 409);
      const userId = requirePrincipal(request).userId;
      const deviceId = uuid(body.device_id, "device_id");
      uuid(body.batch_id, "batch_id");
      if (!Array.isArray(body.operations) || body.operations.length < 1 || body.operations.length > MAX_BATCH_SIZE) throw new SyncRequestError("INVALID_BATCH", `operations must contain 1 to ${MAX_BATCH_SIZE} entries.`);
      const operations = body.operations.map(normalizeOperation);
      const seen = new Set<string>();
      operations.forEach((operation, index) => {
        if (seen.has(operation.operation_id)) throw new SyncRequestError("INVALID_BATCH", "operation_id values must be unique within a batch.");
        for (const dependency of operation.depends_on) {
          const dependencyIndex = operations.findIndex((candidate) => candidate.operation_id === dependency);
          if (dependencyIndex >= index && dependencyIndex !== -1) throw new SyncRequestError("INVALID_BATCH", "Operations must be ordered after their dependencies.");
        }
        seen.add(operation.operation_id);
      });
      const device = await database.query<{ id: string } & QueryResultRow>("SELECT id FROM sync_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [deviceId, userId]);
      if (!device.rows.length) throw new SyncRequestError("DEVICE_NOT_REGISTERED", "Register this device before syncing.", 403);
      const pool = poolFrom(database);
      if (!pool) throw new SyncRequestError("SYNC_UNAVAILABLE", "Sync storage is unavailable.", 503);
      const results = new Map<string, SyncOperationResult>();
      for (const operation of operations) results.set(operation.operation_id, await processOperation(pool, userId, operation, results));
      response.status(200).json({ protocol_version: 1, batch_id: body.batch_id, results: [...results.values()] });
    } catch (error) { sendError(response, error); }
  });

  router.post("/pull", async (request, response) => {
    try {
      const body = record(request.body, "request");
      exactKeys(body, ["device_id", "after_cursor", "limit"], "request");
      const userId = requirePrincipal(request).userId;
      const deviceId = uuid(body.device_id, "device_id");
      const after = parseCursor(body.after_cursor, "after_cursor");
      const limit = body.limit ?? 200;
      if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_PULL_SIZE) throw new SyncRequestError("INVALID_LIMIT", `limit must be between 1 and ${MAX_PULL_SIZE}.`);
      const registered = await database.query<{ id: string } & QueryResultRow>("SELECT id FROM sync_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [deviceId, userId]);
      if (!registered.rows.length) throw new SyncRequestError("DEVICE_NOT_REGISTERED", "Register this device before syncing.", 403);
      const currentResult = await database.query<{ last_cursor: string } & QueryResultRow>("SELECT last_cursor::text AS last_cursor FROM sync_cursors WHERE owner_id=$1", [userId]);
      const current = BigInt(currentResult.rows[0]?.last_cursor ?? "0");
      if (after > current) throw new SyncRequestError("CURSOR_AHEAD", "The requested cursor is ahead of the server.", 409);
      const feed = await database.query<{ cursor: string; entity_type: string; entity_id: string; entity_version: number; change_type: "upsert" | "delete" } & QueryResultRow>(
        `SELECT cursor::text AS cursor, entity_type, entity_id, entity_version, change_type
         FROM sync_changes WHERE owner_id=$1 AND cursor>$2 AND entity_type='pet'
         ORDER BY cursor LIMIT $3`,
        [userId, after.toString(), (limit as number) + 1],
      );
      const hasMore = feed.rows.length > (limit as number);
      const pageRows = feed.rows.slice(0, limit as number);
      const changes: PetSyncChange[] = [];
      for (const entry of pageRows) {
        const pet = await database.query<Record<string, unknown> & QueryResultRow>(`SELECT ${PET_SELECT} FROM pets WHERE owner_id=$1 AND id=$2`, [userId, entry.entity_id]);
        if (!pet.rows[0]) continue;
        changes.push({ ...toPetSnapshot(pet.rows[0]), entity_type: "pet", entity_version: Number(pet.rows[0].version), change_type: pet.rows[0].deleted_at ? "delete" : "upsert", cursor: entry.cursor });
      }
      const last = pageRows.at(-1)?.cursor ?? current.toString();
      response.status(200).json({ protocol_version: 1, changes, next_cursor: last, has_more: hasMore });
    } catch (error) { sendError(response, error); }
  });

  router.post("/ack", async (request, response) => {
    try {
      const body = record(request.body, "request");
      exactKeys(body, ["device_id", "cursor"], "request");
      const userId = requirePrincipal(request).userId;
      const deviceId = uuid(body.device_id, "device_id");
      const cursor = parseCursor(body.cursor, "cursor");
      const client = await database.query<{ last_cursor: string } & QueryResultRow>("SELECT last_cursor::text AS last_cursor FROM sync_cursors WHERE owner_id=$1", [userId]);
      const maxCursor = BigInt(client.rows[0]?.last_cursor ?? "0");
      if (cursor > maxCursor) throw new SyncRequestError("CURSOR_AHEAD", "The acknowledged cursor is ahead of the server.", 409);
      const updated = await database.query<{ id: string } & QueryResultRow>(
        `UPDATE sync_devices SET last_download_cursor=GREATEST(last_download_cursor,$3),last_seen_at=now(),updated_at=now()
         WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,
        [deviceId, userId, cursor.toString()],
      );
      if (!updated.rows.length) throw new SyncRequestError("DEVICE_NOT_REGISTERED", "Register this device before syncing.", 403);
      response.status(200).json({ device_id: deviceId, cursor: cursor.toString(), acknowledged: true });
    } catch (error) { sendError(response, error); }
  });

  return router;
}

function sendError(response: import("express").Response, error: unknown): void {
  if (error instanceof SyncRequestError) {
    response.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }
  response.status(500).json({ error: { code: "SYNC_FAILED", message: "The synchronization request could not be completed." } });
}
