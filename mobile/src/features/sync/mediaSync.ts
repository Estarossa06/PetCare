import { getPetCareDatabase } from "../../db/database";
import { getActiveLocalAuthUserId, getLocalAccountId, withLocalWriteTransaction } from "../../db/localAccount";
import { apiClient } from "../auth/apiClient";
import { medicalFileStorage } from "../medical/medicalFileStorage";
import { petPhotoStorage } from "../pets/petPhotoStorage";
import { sha256Hex } from "./mediaQueue";

type QueueItem = {
  operation_id: string; asset_id: string; resource_type: "pet_photo" | "health_attachment";
  resource_id: string; pet_id: string; health_record_id: string | null; action: "upload" | "delete";
  local_storage_key: string | null; original_filename: string; mime_type: string; size_bytes: number;
  sha256: string | null; attempt_count: number;
};
type Asset = { id: string; purpose: "pet_photo" | "health_attachment"; petId: string; healthRecordId: string | null; originalFilename: string; mimeType: string; sizeBytes: number; sha256: string; cursor: string; deletedAt: string | null };

function extension(filename: string): string { return filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase().replace(/[^.a-z0-9]/g, "") : ".bin"; }
function retryAt(attempt: number): string { return new Date(Date.now() + Math.min(6 * 60 * 60_000, 5_000 * 2 ** Math.min(attempt, 10))).toISOString(); }

async function blobFor(item: QueueItem): Promise<Blob> {
  if (!item.local_storage_key) throw new Error("No se encontró la copia local del archivo.");
  return item.resource_type === "pet_photo" ? petPhotoStorage.readPhoto(item.local_storage_key) : medicalFileStorage.read(item.local_storage_key);
}

async function pushMedia(accountId: string): Promise<void> {
  const db = await getPetCareDatabase();
  const now = new Date().toISOString();
  const items = await db.getAllAsync<QueueItem>(`SELECT q.* FROM media_upload_queue q
    WHERE q.account_id=? AND q.status IN ('pending','failed') AND (q.next_retry_at IS NULL OR q.next_retry_at<=?)
      AND (q.resource_type='pet_photo' AND EXISTS(SELECT 1 FROM pets p WHERE p.owner_id=q.account_id AND p.id=q.pet_id AND p.server_version>0 AND p.deleted_at IS NULL)
        OR q.resource_type='health_attachment' AND EXISTS(SELECT 1 FROM health_records h WHERE h.owner_id=q.account_id AND h.id=q.health_record_id AND h.server_version>0 AND h.deleted_at IS NULL))
    ORDER BY q.created_at LIMIT 20`, accountId, now);
  for (const item of items) {
    await withLocalWriteTransaction(async (tx, owner) => { if (owner === accountId) await tx.runAsync("UPDATE media_upload_queue SET status='in_flight',attempt_count=attempt_count+1,updated_at=? WHERE account_id=? AND operation_id=?", new Date().toISOString(), owner, item.operation_id); });
    try {
      if (item.action === "delete") {
        await apiClient.requestRaw(`/media/assets/${item.asset_id}`, { method: "DELETE" });
      } else {
        const blob = await blobFor(item);
        const digest = await sha256Hex(await blob.arrayBuffer());
        if (!item.sha256 || digest !== item.sha256 || blob.size !== item.size_bytes) throw new Error("La copia local cambió; se conservó para revisión y no se subió.");
        const path = item.resource_type === "pet_photo" ? `/media/pets/${item.pet_id}/photo` : `/media/health-records/${item.health_record_id}/attachments`;
        const headers: Record<string, string> = { "Content-Type": item.mime_type, "X-Upload-Id": item.asset_id, "X-Checksum-Sha256": digest, "X-File-Name": encodeURIComponent(item.original_filename) };
        if (item.resource_type === "health_attachment") headers["X-Pet-Id"] = item.pet_id;
        const response = await apiClient.requestRaw(path, { method: "POST", body: blob, headers });
        const acknowledgement = await response.json() as { asset?: { id?: string; sha256?: string } };
        if (acknowledgement.asset?.id !== item.asset_id || acknowledgement.asset.sha256 !== digest) throw new Error("La API no confirmó el archivo esperado.");
        await withLocalWriteTransaction(async (tx, owner) => {
          if (owner !== accountId) return;
          if (item.resource_type === "pet_photo") await tx.runAsync("UPDATE pets SET photo_remote_asset_id=? WHERE owner_id=? AND id=? AND photo_storage_key=?", item.asset_id, owner, item.pet_id, item.local_storage_key);
          else await tx.runAsync("UPDATE health_attachments SET remote_asset_id=?,sha256=?,upload_status='uploaded',version=MAX(version,1),updated_at=? WHERE owner_id=? AND id=?", item.asset_id, digest, new Date().toISOString(), owner, item.asset_id);
        });
      }
      await db.runAsync("DELETE FROM media_upload_queue WHERE account_id=? AND operation_id=?", accountId, item.operation_id);
    } catch (error) {
      const attempt = item.attempt_count + 1;
      await db.runAsync("UPDATE media_upload_queue SET status='failed',next_retry_at=?,last_error=?,updated_at=? WHERE account_id=? AND operation_id=?", retryAt(attempt), error instanceof Error ? error.message.slice(0, 300) : "UPLOAD_FAILED", new Date().toISOString(), accountId, item.operation_id);
      if (item.resource_type === "health_attachment") await db.runAsync("UPDATE health_attachments SET upload_status='failed' WHERE owner_id=? AND id=?", accountId, item.asset_id);
    }
  }
}

async function pullMedia(accountId: string): Promise<void> {
  const db = await getPetCareDatabase();
  let cursor = (await db.getFirstAsync<{ media_download_cursor: number }>("SELECT media_download_cursor FROM sync_metadata WHERE account_id=?", accountId))?.media_download_cursor ?? 0;
  for (let pageNo = 0; pageNo < 100; pageNo += 1) {
    const page = await apiClient.request<{ assets: Asset[]; nextCursor: string; hasMore: boolean }>(`/media/changes?after_cursor=${cursor}&limit=100`, { authenticated: true });
    for (const asset of page.assets) {
      if (asset.deletedAt) {
        if (asset.purpose === "pet_photo") {
          const pet = await db.getFirstAsync<{ photo_storage_key: string | null }>("SELECT photo_storage_key FROM pets WHERE owner_id=? AND id=? AND photo_remote_asset_id=?", accountId, asset.petId, asset.id);
          if (pet?.photo_storage_key) await petPhotoStorage.deletePhoto(pet.photo_storage_key);
          await db.runAsync("UPDATE pets SET photo_remote_asset_id=NULL,photo_storage_key=NULL WHERE owner_id=? AND id=? AND photo_remote_asset_id=?", accountId, asset.petId, asset.id);
        } else {
          const attachment = await db.getFirstAsync<{ storage_key: string }>("SELECT storage_key FROM health_attachments WHERE owner_id=? AND id=?", accountId, asset.id);
          if (attachment?.storage_key) await medicalFileStorage.delete(attachment.storage_key);
          await db.runAsync("UPDATE health_attachments SET deleted_at=?,updated_at=?,upload_status='deleted' WHERE owner_id=? AND id=?", asset.deletedAt, new Date().toISOString(), accountId, asset.id);
        }
        continue;
      }
      const localKey = asset.purpose === "pet_photo" ? `pet-photos/remote-${asset.id}${extension(asset.originalFilename)}` : `medical-files/remote-${asset.id}${extension(asset.originalFilename)}`;
      const present = asset.purpose === "pet_photo" ? await petPhotoStorage.getPhotoUri(localKey) : await medicalFileStorage.getUri(localKey);
      if (!present) {
        const response = await apiClient.requestRaw(`/media/assets/${asset.id}/content`, { method: "GET" });
        const blob = await response.blob();
        if (blob.size !== asset.sizeBytes || await sha256Hex(await blob.arrayBuffer()) !== asset.sha256 || response.headers.get("X-Content-SHA256") !== asset.sha256) throw new Error("La descarga no superó la verificación de integridad.");
        if (asset.purpose === "pet_photo") await petPhotoStorage.saveRemotePhoto(localKey, blob);
        else await medicalFileStorage.saveRemote(localKey, blob);
      }
      await withLocalWriteTransaction(async (tx, owner) => {
        if (owner !== accountId) return;
        if (asset.purpose === "pet_photo") await tx.runAsync("UPDATE pets SET photo_storage_key=?,photo_remote_asset_id=? WHERE owner_id=? AND id=? AND (photo_remote_asset_id IS NULL OR photo_remote_asset_id=?)", localKey, asset.id, owner, asset.petId, asset.id);
        else await tx.runAsync(`INSERT INTO health_attachments(id,owner_id,pet_id,health_record_id,storage_key,local_uri,original_filename,mime_type,size_bytes,version,created_at,updated_at,remote_asset_id,sha256,upload_status)
          VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,'uploaded') ON CONFLICT(owner_id,id) DO UPDATE SET storage_key=excluded.storage_key,remote_asset_id=excluded.remote_asset_id,sha256=excluded.sha256,upload_status='uploaded',updated_at=excluded.updated_at`,
          asset.id, owner, asset.petId, asset.healthRecordId, localKey, asset.originalFilename, asset.mimeType, asset.sizeBytes, 1, new Date().toISOString(), new Date().toISOString(), asset.id, asset.sha256);
      });
    }
    cursor = Number(page.nextCursor);
    await db.runAsync("UPDATE sync_metadata SET media_download_cursor=?,updated_at=? WHERE account_id=?", cursor, new Date().toISOString(), accountId);
    if (!page.hasMore) break;
  }
}

export async function synchronizeMedia(): Promise<void> {
  if (!getActiveLocalAuthUserId()) return;
  const accountId = await getLocalAccountId();
  await pushMedia(accountId);
  await pullMedia(accountId);
}
