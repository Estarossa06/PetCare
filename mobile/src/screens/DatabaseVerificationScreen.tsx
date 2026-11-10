import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import * as SQLite from "expo-sqlite";
import { migrateLocalDatabase } from "../db/migrate";
import { verifyLocalDatabase } from "../db/verify";
import { verifyCareRecurrence } from "../care/verifyRecurrence";

type VerificationState =
  | { completed: string[]; status: "running" }
  | { completed: string[]; status: "passed" }
  | { completed: string[]; status: "pending-reload" }
  | { completed: string[]; error: string; status: "failed" };

type VerificationResult = {
  completed: string[];
  pendingReload: boolean;
};

const verificationPetId = "00000000-0000-4000-8000-000000000101";
const verificationOwnerId = "00000000-0000-4000-8000-000000000102";

async function runDatabaseVerification(): Promise<VerificationResult> {
  let database = await SQLite.openDatabaseAsync("petcare-verification.db");
  let databaseIsOpen = true;
  try {
    await migrateLocalDatabase(database);
    await migrateLocalDatabase(database);
    const completed = ["Database opened; migrations applied and safely repeated."];

    const tables = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    const tableNames = new Set(tables.map(({ name }) => name));
    const requiredTables = [
      "pets",
      "health_records",
      "health_attachments",
      "care_tasks",
      "care_task_executions",
      "reminders",
      "calendar_events",
      "calendar_reminders",
      "calendar_scheduled_notifications",
      "sync_queue",
      "sync_queue_dependencies",
      "sync_metadata",
      "sync_conflicts",
      "scheduled_notifications",
      "_local_migrations",
    ];
    const missingTables = requiredTables.filter((name) => !tableNames.has(name));
    if (missingTables.length > 0) {
      throw new Error(`Missing SQLite tables: ${missingTables.join(", ")}.`);
    }

    await verifyLocalDatabase(database);
    verifyCareRecurrence();
    const healthMigration = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM _local_migrations WHERE version = 2",
    );
    if (healthMigration?.name !== "health_record_details_and_exams") {
      throw new Error("The incremental medical-history migration was not applied.");
    }
    const calendarMigration = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM _local_migrations WHERE version = 4",
    );
    if (calendarMigration?.name !== "calendar_events_and_reminders") {
      throw new Error("The incremental calendar migration was not applied.");
    }
    const calendarIntegrityMigration = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM _local_migrations WHERE version = 5",
    );
    if (calendarIntegrityMigration?.name !== "calendar_reminder_target_pet_integrity") {
      throw new Error("The calendar reminder integrity migration was not applied.");
    }
    completed.push("UUID, health/care/calendar foreign-key and owner-isolation, version, soft-delete, multiple reminder, and sync dependency checks passed.");
    completed.push("Daily DST, nonexistent local time, month-end anchoring, and one-time recurrence checks passed.");

    const previousRun = await database.getFirstAsync<{
      name: string;
      deleted_at: string | null;
      version: number;
    }>(
      "SELECT name, deleted_at, version FROM pets WHERE id = ?",
      verificationPetId,
    );
    const survivedAppReload =
      previousRun?.name === "App reload persistence probe" &&
      previousRun.deleted_at !== null &&
      previousRun.version === 1;
    if (survivedAppReload) {
      completed.push("Verification data survived app/browser reload.");
    }
    await database.runAsync("DELETE FROM pets WHERE id = ?", verificationPetId);
    const timestamp = new Date().toISOString();
    await database.runAsync(
      `INSERT INTO pets (id, owner_id, name, species, created_at, updated_at)
       VALUES (?, ?, 'Persistence verification', 'dog', ?, ?)`,
      verificationPetId,
      verificationOwnerId,
      timestamp,
      timestamp,
    );
    const inserted = await database.getFirstAsync<{ name: string; version: number }>(
      "SELECT name, version FROM pets WHERE id = ?",
      verificationPetId,
    );
    if (inserted?.name !== "Persistence verification" || inserted.version !== 0) {
      throw new Error("SQLite insert/read or initial server-version check failed.");
    }

    await database.runAsync(
      "UPDATE pets SET name = ?, updated_at = ? WHERE id = ?",
      "Updated persistence verification",
      timestamp,
      verificationPetId,
    );
    await database.runAsync(
      "UPDATE pets SET deleted_at = ?, version = version + 1 WHERE id = ?",
      timestamp,
      verificationPetId,
    );
    await database.closeAsync();
    databaseIsOpen = false;

    database = await SQLite.openDatabaseAsync("petcare-verification.db");
    databaseIsOpen = true;
    await migrateLocalDatabase(database);
    const reopened = await database.getFirstAsync<{
      name: string;
      deleted_at: string | null;
      version: number;
    }>(
      "SELECT name, deleted_at, version FROM pets WHERE id = ?",
      verificationPetId,
    );
    if (
      reopened?.name !== "Updated persistence verification" ||
      !reopened.deleted_at ||
      reopened.version !== 1
    ) {
      throw new Error("SQLite data did not persist correctly after close and reopen.");
    }
    completed.push("Insert, read, update, soft delete, close/reopen persistence checks passed.");

    if (survivedAppReload) {
      await database.runAsync("DELETE FROM pets WHERE id = ?", verificationPetId);
      completed.push("Temporary verification row removed.");
    } else {
      await database.runAsync(
        "UPDATE pets SET name = ? WHERE id = ?",
        "App reload persistence probe",
        verificationPetId,
      );
      completed.push("Close and reopen the app/browser to complete the persistence check.");
    }
    return { completed, pendingReload: !survivedAppReload };
  } finally {
    if (databaseIsOpen) {
      await database.closeAsync();
    }
  }
}

let verificationRun: Promise<VerificationResult> | undefined;

export default function DatabaseVerificationScreen() {
  const [verification, setVerification] = useState<VerificationState>({
    completed: [],
    status: "running",
  });

  useEffect(() => {
    let active = true;
    verificationRun ??= runDatabaseVerification();
    void verificationRun.then(
      ({ completed, pendingReload }) => {
        if (active) {
          setVerification({
            completed,
            status: pendingReload ? "pending-reload" : "passed",
          });
        }
      },
      (error: unknown) => {
        if (active) {
          setVerification({
            completed: [],
            status: "failed",
            error: error instanceof Error ? error.message : "Unexpected verification error.",
          });
        }
      },
    );
    return () => { active = false; };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {verification.status === "running" ? (
          <>
            <ActivityIndicator />
            <Text style={styles.title}>Checking local SQLite</Text>
          </>
        ) : verification.status === "passed" ? (
          <Text style={styles.title}>SQLite verification passed</Text>
        ) : verification.status === "pending-reload" ? (
          <Text style={styles.title}>Close and reopen the app to finish persistence verification</Text>
        ) : (
          <>
            <Text style={styles.title}>SQLite verification failed</Text>
            <Text selectable style={styles.error}>
              {verification.error}
            </Text>
          </>
        )}
        {verification.completed.map((step) => (
          <Text key={step} style={styles.detail}>
            {step}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    flex: 1,
    alignItems: "stretch",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  detail: {
    textAlign: "center",
    color: "#46515c",
  },
  error: {
    color: "#a32121",
    textAlign: "center",
  },
});
