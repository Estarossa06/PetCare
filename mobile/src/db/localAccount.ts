import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import { getPetCareDatabase } from "./database";

let accountIdPromise: Promise<string> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

export async function getLocalAccountId(): Promise<string> {
  accountIdPromise ??= (async () => {
    const db = await getPetCareDatabase();
    const existing = await db.getFirstAsync<{ account_id: string }>(
      "SELECT account_id FROM sync_metadata ORDER BY updated_at LIMIT 1",
    );
    if (existing) return existing.account_id;

    await db.execAsync("BEGIN IMMEDIATE");
    try {
      const current = await db.getFirstAsync<{ account_id: string }>(
        "SELECT account_id FROM sync_metadata ORDER BY updated_at LIMIT 1",
      );
      if (current) {
        await db.execAsync("COMMIT");
        return current.account_id;
      }
      const accountId = Crypto.randomUUID().toLowerCase();
      await db.runAsync(
        "INSERT INTO sync_metadata (account_id, updated_at) VALUES (?, ?)",
        accountId,
        new Date().toISOString(),
      );
      await db.execAsync("COMMIT");
      return accountId;
    } catch (error) {
      await db.execAsync("ROLLBACK");
      throw error;
    }
  })();

  const pending = accountIdPromise;
  try {
    return await pending;
  } catch (error) {
    if (accountIdPromise === pending) accountIdPromise = undefined;
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
