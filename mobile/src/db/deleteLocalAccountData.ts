import { getPetCareDatabase } from "./database";
import { getActiveLocalAuthUserId, getLocalAccountId, setActiveLocalAuthUserId, withLocalWriteTransactionForAccount } from "./localAccount";
import { deleteLocalAccountRows } from "./localAccountPurge";
import { petPhotoStorage } from "../features/pets/petPhotoStorage";
import { medicalFileStorage } from "../features/medical/medicalFileStorage";

function addKey(keys: Set<string>, value: string | null | undefined): void {
  if (value) keys.add(value);
}

/** Purges the initiating device's partition and files; it cannot reach offline devices. */
export async function deleteLocalAccountData(authUserId: string): Promise<void> {
  if (getActiveLocalAuthUserId() !== authUserId) throw new Error("The active account changed before local deletion.");
  const accountId = await getLocalAccountId();
  // Stop periodic foreground sync before taking the account partition lock.
  setActiveLocalAuthUserId(null);
  await withLocalWriteTransactionForAccount(accountId, async (tx, ownerId) => {
    if (ownerId !== accountId || getActiveLocalAuthUserId() !== authUserId) throw new Error("The active account changed before local deletion.");
    const keys = new Set<string>();
    const pets = await tx.getAllAsync<{ photo_storage_key: string | null }>("SELECT photo_storage_key FROM pets WHERE owner_id=?", ownerId);
    for (const row of pets) addKey(keys, row.photo_storage_key);
    const attachments = await tx.getAllAsync<{ storage_key: string | null }>("SELECT storage_key FROM health_attachments WHERE owner_id=?", ownerId);
    for (const row of attachments) addKey(keys, row.storage_key);
    const queued = await tx.getAllAsync<{ local_storage_key: string | null }>("SELECT local_storage_key FROM media_upload_queue WHERE account_id=?", ownerId);
    for (const row of queued) addKey(keys, row.local_storage_key);

    const failures: unknown[] = [];
    for (const key of keys) {
      try {
        if (key.startsWith("pet-photos/")) await petPhotoStorage.deletePhoto(key);
        else if (key.startsWith("medical-files/")) await medicalFileStorage.delete(key);
        else throw new Error("A local media key is outside the supported application storage directories.");
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Some local account files could not be removed.");
    await deleteLocalAccountRows(tx, ownerId);
  });
}
