import * as SQLite from "expo-sqlite";
import { migrateLocalDatabase, recoverInterruptedSync } from "./migrate";

const databaseName = "petcare.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

export async function getPetCareDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= (async () => {
    const database = await SQLite.openDatabaseAsync(databaseName);
    try {
      await migrateLocalDatabase(database);
      await recoverInterruptedSync(database);
      return database;
    } catch (error) {
      await database.closeAsync();
      throw error;
    }
  })();

  try {
    return await databasePromise;
  } catch (error) {
    databasePromise = undefined;
    throw error;
  }
}
