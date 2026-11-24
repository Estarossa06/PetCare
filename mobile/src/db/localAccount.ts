import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import { getPetCareDatabase } from "./database";

let activeAuthUserId: string | null = null;
const accountIdPromises = new Map<string, Promise<string>>();
let writeQueue: Promise<void> = Promise.resolve();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function setActiveLocalAuthUserId(userId: string | null): void {
  if (userId !== null && !UUID_PATTERN.test(userId)) {
    throw new Error("Authenticated user ID must be a UUID.");
  }
  activeAuthUserId = userId?.toLowerCase() ?? null;
}

export function getActiveLocalAuthUserId(): string | null {
  return activeAuthUserId;
}

export async function getLocalAccountId(): Promise<string> {
  const authUserId = activeAuthUserId;
  const cacheKey = authUserId ?? "anonymous-local-account";
  let accountIdPromise = accountIdPromises.get(cacheKey);
  if (!accountIdPromise) {
    accountIdPromise = (async () => {
      const db = await getPetCareDatabase();
      const findAccount = () => authUserId
        ? db.getFirstAsync<{ account_id: string }>(
          "SELECT account_id FROM sync_metadata WHERE auth_user_id = ?",
          authUserId,
        )
        : db.getFirstAsync<{ account_id: string }>(
          "SELECT account_id FROM sync_metadata WHERE auth_user_id IS NULL ORDER BY updated_at LIMIT 1",
        );
      const existing = await findAccount();
      if (existing) return existing.account_id;

      await db.execAsync("BEGIN IMMEDIATE");
      try {
        const current = await findAccount();
        if (current) {
          await db.execAsync("COMMIT");
          return current.account_id;
        }
        const accountId = Crypto.randomUUID().toLowerCase();
        await db.runAsync(
          "INSERT INTO sync_metadata (account_id, auth_user_id, updated_at) VALUES (?, ?, ?)",
          accountId,
          authUserId,
          new Date().toISOString(),
        );
        await db.execAsync("COMMIT");
        return accountId;
      } catch (error) {
        await db.execAsync("ROLLBACK");
        throw error;
      }
    })();
    accountIdPromises.set(cacheKey, accountIdPromise);
  }

  const pending = accountIdPromise;
  try {
    return await pending;
  } catch (error) {
    if (accountIdPromises.get(cacheKey) === pending) accountIdPromises.delete(cacheKey);
    throw error;
  }
}

export async function withLocalWriteTransaction<T>(
  work: (tx: SQLiteDatabase, ownerId: string) => Promise<T>,
): Promise<T> {
  const previous = writeQueue;
  let release = () => {};
  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    await db.execAsync("BEGIN IMMEDIATE");
    try {
      const result = await work(db, ownerId);
      await db.execAsync("COMMIT");
      return result;
    } catch (error) {
      await db.execAsync("ROLLBACK");
      throw error;
    }
  } finally {
    release();
  }
}
