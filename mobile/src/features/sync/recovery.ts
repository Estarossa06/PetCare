import * as Crypto from "expo-crypto";
import { getPetCareDatabase } from "../../db/database";
import { getActiveLocalAuthUserId, getLocalAccountId, withLocalWriteTransaction } from "../../db/localAccount";
import { listSyncItemsForAccount, resolveConflictForAccount, retryFailedForAccount, type SyncChoice, type SyncItem } from "./recoveryCore";

export type { SyncChoice, SyncItem } from "./recoveryCore";
export { listSyncItemsForAccount, resolveConflictForAccount, retryFailedForAccount } from "./recoveryCore";

export async function getSyncItems(): Promise<SyncItem[]> {
  const authId = getActiveLocalAuthUserId();
  if (!authId) return [];
  const accountId = await getLocalAccountId();
  if (getActiveLocalAuthUserId() !== authId) throw new Error("La cuenta cambió mientras se consultaba la sincronización.");
  return listSyncItemsForAccount(await getPetCareDatabase(), accountId);
}

export async function retrySyncOperation(operationId: string): Promise<void> {
  const authId = getActiveLocalAuthUserId();
  if (!authId) throw new Error("Inicia sesión para administrar la sincronización.");
  const accountId = await getLocalAccountId();
  await withLocalWriteTransaction(async (tx, owner) => {
    if (owner !== accountId || getActiveLocalAuthUserId() !== authId) throw new Error("La cuenta cambió; vuelve a cargar esta pantalla.");
    await retryFailedForAccount(tx, owner, operationId, () => Crypto.randomUUID());
  });
}

export async function resolveSyncConflict(conflictId: string, choice: SyncChoice): Promise<void> {
  const authId = getActiveLocalAuthUserId();
  if (!authId) throw new Error("Inicia sesión para resolver conflictos.");
  const accountId = await getLocalAccountId();
  await withLocalWriteTransaction(async (tx, owner) => {
    if (owner !== accountId || getActiveLocalAuthUserId() !== authId) throw new Error("La cuenta cambió; vuelve a cargar esta pantalla.");
    await resolveConflictForAccount(tx, owner, conflictId, choice, () => Crypto.randomUUID());
  });
}

export async function getLastSuccessfulSync(): Promise<string | null> {
  if (!getActiveLocalAuthUserId()) return null;
  const accountId = await getLocalAccountId();
  const row = await (await getPetCareDatabase()).getFirstAsync<{ last_successful_sync_at: string | null }>(
    "SELECT last_successful_sync_at FROM sync_metadata WHERE account_id=?", accountId,
  );
  return row?.last_successful_sync_at ?? null;
}
