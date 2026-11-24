import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";

export async function enqueueMediaUpload(tx: SQLiteDatabase, input: {
  accountId: string; assetId: string; resourceType: "pet_photo" | "health_attachment";
  resourceId: string; petId: string; healthRecordId?: string | null; localStorageKey: string;
  filename: string; mimeType: string; size: number; sha256: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await tx.runAsync(`INSERT OR IGNORE INTO media_upload_queue
    (operation_id,account_id,asset_id,resource_type,resource_id,pet_id,health_record_id,action,local_storage_key,original_filename,mime_type,size_bytes,sha256,status,attempt_count,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'upload',?,?,?,?,?,'pending',0,?,?)`,
  Crypto.randomUUID().toLowerCase(), input.accountId, input.assetId, input.resourceType,
  input.resourceId, input.petId, input.healthRecordId ?? null, input.localStorageKey,
  input.filename, input.mimeType, input.size, input.sha256, now, now);
}

export async function enqueueMediaDelete(tx: SQLiteDatabase, input: {
  accountId: string; assetId: string; resourceType: "pet_photo" | "health_attachment";
  resourceId: string; petId: string; healthRecordId?: string | null;
  filename: string; mimeType: string; size?: number;
}): Promise<void> {
  await tx.runAsync("DELETE FROM media_upload_queue WHERE account_id=? AND asset_id=? AND action='upload'", input.accountId, input.assetId);
  const existing = await tx.getFirstAsync<{ operation_id: string }>("SELECT operation_id FROM media_upload_queue WHERE account_id=? AND asset_id=? AND action='delete' LIMIT 1", input.accountId, input.assetId);
  if (existing) return;
  const now = new Date().toISOString();
  await tx.runAsync(`INSERT INTO media_upload_queue
    (operation_id,account_id,asset_id,resource_type,resource_id,pet_id,health_record_id,action,local_storage_key,original_filename,mime_type,size_bytes,sha256,status,attempt_count,created_at,updated_at)
    VALUES(?,?,?,?,?, ?,?,'delete',NULL,?,?,?,NULL,'pending',0,?,?)`,
  Crypto.randomUUID().toLowerCase(), input.accountId, input.assetId, input.resourceType,
  input.resourceId, input.petId, input.healthRecordId ?? null, input.filename,
  input.mimeType, input.size ?? 0, now, now);
}

export function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
    .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}
