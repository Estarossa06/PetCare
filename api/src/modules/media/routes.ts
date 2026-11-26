import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { Router, type Request, type Response } from "express";
import type { QueryResultRow } from "pg";
import type { Queryable } from "../../db/queryable.js";
import type { Logger } from "../../observability/logger.js";
import { createAuthenticateMiddleware, requirePrincipal } from "../auth/middleware/authenticate.js";
import type { AuthStore } from "../auth/types.js";
import { MediaValidationError, validateMediaFile, type MediaPurpose } from "./validation.js";
import type { MediaObjectStore } from "./objectStore.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type MediaDb = Queryable & { connect?: () => Promise<{ query<T extends QueryResultRow = QueryResultRow>(sql: string, args?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>; release(): void }> };
type MediaRow = {
  id: string; owner_id: string; purpose: MediaPurpose; pet_id: string; health_record_id: string | null;
  object_key: string; original_filename: string; mime_type: string; size_bytes: string | number;
  sha256: string; version: number; cursor: string; created_at: string; updated_at: string; deleted_at: string | null;
};

function invalid(status = 400, code = "INVALID_MEDIA_REQUEST"): MediaValidationError {
  return new MediaValidationError(code, "La solicitud del archivo no es válida.", status);
}
function requestId(response: Response): string { return String(response.getHeader("X-Request-Id") ?? ""); }
function mapAsset(row: MediaRow) {
  return { id: row.id, purpose: row.purpose, petId: row.pet_id, healthRecordId: row.health_record_id,
    originalFilename: row.original_filename, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes),
    sha256: row.sha256.trim(), version: row.version, cursor: row.cursor, createdAt: row.created_at, deletedAt: row.deleted_at };
}

async function writeIncoming(request: Request, expectedSize: number | undefined, maxBytes: number, path: string) {
  const sha = createHash("sha256"), md5 = createHash("md5");
  let size = 0;
  const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    if (size > maxBytes) { callback(new MediaValidationError("MEDIA_TOO_LARGE", "El archivo supera el tamaño máximo permitido.", 413)); return; }
    sha.update(chunk); md5.update(chunk); callback(null, chunk);
  } });
  await pipeline(request, counter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
  if (expectedSize !== undefined && size !== expectedSize) throw invalid(400, "MEDIA_LENGTH_MISMATCH");
  return { size, sha256: sha.digest("hex"), contentMd5: md5.digest("base64") };
}

async function verifyParent(database: Queryable, ownerId: string, purpose: MediaPurpose, petId: string, recordId?: string) {
  const pet = await database.query<{ id: string } & QueryResultRow>(
    "SELECT id FROM pets WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL", [ownerId, petId]);
  if (!pet.rows.length) throw invalid(404, "MEDIA_PARENT_NOT_FOUND");
  if (purpose === "health_attachment") {
    if (!recordId || !UUID.test(recordId)) throw invalid();
    const record = await database.query<{ id: string } & QueryResultRow>(
      "SELECT id FROM health_records WHERE owner_id=$1 AND pet_id=$2 AND id=$3 AND deleted_at IS NULL", [ownerId, petId, recordId]);
    if (!record.rows.length) throw invalid(404, "MEDIA_PARENT_NOT_FOUND");
  }
}

async function upload(request: Request, response: Response, database: MediaDb, store: MediaObjectStore, logger: Logger, purpose: MediaPurpose, petIdRaw: string, recordIdRaw?: string) {
  const ownerId = requirePrincipal(request).userId;
  const petId = petIdRaw.toLowerCase();
  const recordId = recordIdRaw?.toLowerCase();
  const assetId = request.get("X-Upload-Id")?.toLowerCase() ?? "";
  const suppliedHash = request.get("X-Checksum-Sha256")?.toLowerCase() ?? "";
  const filenameHeader = request.get("X-File-Name") ?? "";
  const mimeType = request.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const contentLengthHeader = request.get("Content-Length");
  const contentLength = contentLengthHeader === undefined ? undefined : Number(contentLengthHeader);
  const maxBytes = purpose === "pet_photo" ? 10 * 1024 * 1024 : 15 * 1024 * 1024;
  if (!UUID.test(petId) || !UUID.test(assetId) || (recordIdRaw && (!recordId || !UUID.test(recordId))) || !/^[a-f0-9]{64}$/.test(suppliedHash) || (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxBytes)) || !filenameHeader || filenameHeader.length > 600) throw invalid(contentLength !== undefined && contentLength > maxBytes ? 413 : 400, contentLength !== undefined && contentLength > maxBytes ? "MEDIA_TOO_LARGE" : "INVALID_MEDIA_REQUEST");
  let filename: string;
  try { filename = decodeURIComponent(filenameHeader); } catch { throw invalid(); }
  await verifyParent(database, ownerId, purpose, petId, recordId);
  const directory = await mkdtemp(join(tmpdir(), "petcare-media-"));
  const tempFile = join(directory, randomUUID());
  let objectKey = "";
  let stored = false;
  let committedTransaction = false;
  let pg: Awaited<ReturnType<NonNullable<MediaDb["connect"]>>> | undefined;
  let transactionOpen = false;
  try {
    const received = await writeIncoming(request, contentLength, maxBytes, tempFile);
    if (received.sha256 !== suppliedHash) throw new MediaValidationError("CHECKSUM_MISMATCH", "La integridad del archivo no coincide.", 422);
    const validated = await validateMediaFile(tempFile, purpose, mimeType, filename, received.size);
    pg = await database.connect?.();
    if (!pg) throw new Error("Media persistence requires a transactional PostgreSQL pool.");
    await pg.query("BEGIN");
    transactionOpen = true;
    const activeOwner = await pg.query("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [ownerId]);
    if (!activeOwner.rows.length) throw invalid(404, "MEDIA_PARENT_NOT_FOUND");
    await verifyParent(pg, ownerId, purpose, petId, recordId);

    // Keep the owner row locked until metadata commits. Account deletion takes
    // an incompatible lock, so its R2 sweep cannot race an in-flight upload.
    const existing = await pg.query<MediaRow & QueryResultRow>("SELECT * FROM media_objects WHERE owner_id=$1 AND id=$2", [ownerId, assetId]);
    if (existing.rows[0]) {
      const old = existing.rows[0];
      if (old.deleted_at || old.sha256.trim() !== received.sha256 || old.purpose !== purpose || old.pet_id !== petId || old.health_record_id !== (recordId ?? null)) throw invalid(409, "MEDIA_IDEMPOTENCY_CONFLICT");
      await pg.query("COMMIT");
      transactionOpen = false;
      response.status(200).json({ asset: mapAsset(old), idempotent: true });
      return;
    }

    objectKey = `media/${ownerId}/${assetId}/${received.sha256}`;
    await store.put(objectKey, tempFile, received.size, validated.mimeType, received.contentMd5);
    stored = true;
    if (purpose === "pet_photo") {
      const previous = await pg.query<MediaRow & QueryResultRow>("SELECT * FROM media_objects WHERE owner_id=$1 AND pet_id=$2 AND purpose='pet_photo' AND deleted_at IS NULL FOR UPDATE", [ownerId, petId]);
      for (const row of previous.rows) {
        await pg.query("UPDATE media_objects SET deleted_at=now(),updated_at=now(),version=version+1,cursor=nextval('media_change_cursor_seq') WHERE owner_id=$1 AND id=$2", [ownerId, row.id]);
        await pg.query("INSERT INTO media_cleanup_queue(object_key) VALUES($1) ON CONFLICT DO NOTHING", [row.object_key]);
      }
    }
    const inserted = await pg.query<MediaRow & QueryResultRow>(
      `INSERT INTO media_objects(id,owner_id,purpose,pet_id,health_record_id,object_key,original_filename,mime_type,size_bytes,sha256)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [assetId, ownerId, purpose, petId, recordId ?? null, objectKey, validated.filename, validated.mimeType, received.size, received.sha256]);
    if (purpose === "health_attachment") {
      await pg.query(
        `INSERT INTO health_attachments(id,owner_id,pet_id,health_record_id,storage_key,remote_storage_key,original_filename,mime_type,size_bytes,sha256,version,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,1,now(),now())
           ON CONFLICT(owner_id,id) DO UPDATE SET storage_key=EXCLUDED.storage_key,remote_storage_key=EXCLUDED.remote_storage_key,
             original_filename=EXCLUDED.original_filename,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,
             sha256=EXCLUDED.sha256,version=health_attachments.version+1,updated_at=now(),deleted_at=NULL`,
        [assetId, ownerId, petId, recordId, objectKey, validated.filename, validated.mimeType, received.size, received.sha256]);
    }
    await pg.query("COMMIT");
    transactionOpen = false;
    committedTransaction = true;
    response.status(201).json({ asset: mapAsset(inserted.rows[0]), idempotent: false });
  } catch (error) {
    if (transactionOpen) await pg?.query("ROLLBACK").catch(() => undefined);
    if (stored && objectKey) {
      try {
        const committed = committedTransaction ? { rows: [{ exists: true }] } : await database.query("SELECT 1 FROM media_objects WHERE object_key=$1 LIMIT 1", [objectKey]);
        if (!committed.rows.length) {
          try { await store.delete(objectKey); }
          catch {
            await database.query("INSERT INTO media_cleanup_queue(object_key) VALUES($1) ON CONFLICT DO NOTHING", [objectKey]);
            logger.error({ event: "media_orphan_cleanup_deferred", requestId: requestId(response), assetId });
          }
        }
      }
      catch { logger.error({ event: "media_orphan_cleanup_failed", requestId: requestId(response), assetId }); }
    }
    if (error instanceof MediaValidationError) throw error;
    logger.error({ event: "media_upload_failed", requestId: requestId(response), purpose });
    throw new MediaValidationError("MEDIA_UNAVAILABLE", "No se pudo guardar el archivo. Conservamos la copia local para reintentar.", 503);
  } finally {
    pg?.release();
    await rm(directory, { recursive: true, force: true });
  }
}

async function download(request: Request, response: Response, database: Queryable, store: MediaObjectStore) {
  const ownerId = requirePrincipal(request).userId;
  const id = String(request.params.assetId ?? "").toLowerCase();
  if (!UUID.test(id)) throw invalid();
  const result = await database.query<MediaRow & QueryResultRow>(
    `SELECT m.* FROM media_objects m
     JOIN pets p ON p.owner_id=m.owner_id AND p.id=m.pet_id AND p.deleted_at IS NULL
     LEFT JOIN health_records h ON h.owner_id=m.owner_id AND h.id=m.health_record_id AND h.pet_id=m.pet_id AND h.deleted_at IS NULL
     WHERE m.owner_id=$1 AND m.id=$2 AND m.deleted_at IS NULL
       AND (m.purpose='pet_photo' OR h.id IS NOT NULL)`, [ownerId, id]);
  const asset = result.rows[0];
  if (!asset) throw invalid(404, "MEDIA_NOT_FOUND");
  const directory = await mkdtemp(join(tmpdir(), "petcare-media-download-"));
  const filePath = join(directory, randomUUID());
  try {
    const hash = createHash("sha256"); let size = 0;
    const source = await store.get(asset.object_key);
    const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; if (size > Number(asset.size_bytes)) { callback(new Error("Stored media length mismatch.")); return; } hash.update(chunk); callback(null, chunk); } });
    await pipeline(source, counter, createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
    const digest = hash.digest("hex");
    if (size !== Number(asset.size_bytes) || digest !== asset.sha256.trim()) throw new Error("Stored media checksum mismatch.");
    response.status(200);
    response.set({ "Content-Type": asset.mime_type, "Content-Length": String(size), "X-Content-SHA256": digest,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.original_filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    const stream = createReadStream(filePath);
    stream.on("error", () => response.destroy());
    response.on("close", () => { void rm(directory, { recursive: true, force: true }); });
    stream.pipe(response);
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new MediaValidationError("MEDIA_UNAVAILABLE", "El archivo no está disponible o no superó la verificación de integridad.", 503);
  }
}

export function createMediaRouter(database: MediaDb, auth: AuthStore, secret: Uint8Array, store: MediaObjectStore | undefined, logger: Logger): Router {
  const router = Router();
  router.use(createAuthenticateMiddleware(auth, secret));
  const requireStore = (response: Response): MediaObjectStore | undefined => {
    if (store) return store;
    response.status(503).json({ error: { code: "MEDIA_STORAGE_UNAVAILABLE", message: "El almacenamiento seguro no está configurado." } });
    return undefined;
  };
  router.post("/pets/:petId/photo", async (request, response, next) => {
    const objectStore = requireStore(response); if (!objectStore) return;
    try { await upload(request, response, database, objectStore, logger, "pet_photo", String(request.params.petId)); }
    catch (error) { next(error); }
  });
  router.post("/health-records/:recordId/attachments", async (request, response, next) => {
    const objectStore = requireStore(response); if (!objectStore) return;
    try { await upload(request, response, database, objectStore, logger, "health_attachment", request.get("X-Pet-Id") ?? "", String(request.params.recordId)); }
    catch (error) { next(error); }
  });
  router.get("/changes", async (request, response, next) => {
    try {
      const ownerId = requirePrincipal(request).userId;
      const after = String(request.query.after_cursor ?? "0"), limit = Number(request.query.limit ?? 200);
      if (!/^(0|[1-9]\d*)$/.test(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw invalid();
      const page = await database.query<MediaRow & QueryResultRow>("SELECT * FROM media_objects WHERE owner_id=$1 AND cursor>$2 ORDER BY cursor LIMIT $3", [ownerId, after, limit + 1]);
      const hasMore = page.rows.length > limit, rows = page.rows.slice(0, limit);
      response.set("Cache-Control", "no-store").status(200).json({ assets: rows.map(mapAsset), nextCursor: rows.at(-1)?.cursor ?? after, hasMore });
    } catch (error) { next(error); }
  });
  router.get("/assets/:assetId/content", async (request, response, next) => {
    const objectStore = requireStore(response); if (!objectStore) return;
    try { await download(request, response, database, objectStore); } catch (error) { next(error); }
  });
  router.delete("/assets/:assetId", async (request, response, next) => {
    try {
      const ownerId = requirePrincipal(request).userId, id = String(request.params.assetId ?? "").toLowerCase();
      if (!UUID.test(id)) throw invalid();
      const pg = await database.connect?.(); if (!pg) throw new Error("Media deletion requires PostgreSQL transactions.");
      try {
        await pg.query("BEGIN");
        const row = await pg.query<MediaRow & QueryResultRow>("UPDATE media_objects SET deleted_at=now(),updated_at=now(),version=version+1,cursor=nextval('media_change_cursor_seq') WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING *", [ownerId,id]);
        if (row.rows[0]) {
          await pg.query("INSERT INTO media_cleanup_queue(object_key) VALUES($1) ON CONFLICT DO NOTHING", [row.rows[0].object_key]);
          if (row.rows[0].purpose === "health_attachment") await pg.query("UPDATE health_attachments SET deleted_at=now(),updated_at=now() WHERE owner_id=$1 AND id=$2", [ownerId,id]);
        }
        await pg.query("COMMIT");
        response.status(204).end();
        if (store && row.rows[0]) void store.delete(row.rows[0].object_key).then(() => database.query("DELETE FROM media_cleanup_queue WHERE object_key=$1", [row.rows[0]!.object_key])).catch(() => logger.error({ event: "media_delete_deferred", requestId: requestId(response), assetId: id }));
      } catch (error) { await pg.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { pg.release(); }
    } catch (error) { next(error); }
  });
  return router;
}
