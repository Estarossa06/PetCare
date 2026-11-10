import type { SqliteExecutor } from "./migrations/types";

const ids = {
  ownerA: "00000000-0000-4000-8000-000000000001",
  ownerB: "00000000-0000-4000-8000-000000000002",
  pet: "00000000-0000-4000-8000-000000000003",
  operationA: "00000000-0000-4000-8000-000000000004",
  operationB: "00000000-0000-4000-8000-000000000005",
  conflict: "00000000-0000-4000-8000-000000000006",
  healthRecord: "00000000-0000-4000-8000-000000000007",
  healthAttachment: "00000000-0000-4000-8000-000000000008",
  healthOperation: "00000000-0000-4000-8000-000000000009",
  attachmentOperation: "00000000-0000-4000-8000-00000000000a",
  careTask: "00000000-0000-4000-8000-00000000000b",
  careExecution: "00000000-0000-4000-8000-00000000000c",
  careTaskOperation: "00000000-0000-4000-8000-00000000000d",
  careExecutionOperation: "00000000-0000-4000-8000-00000000000e",
  calendarEvent: "00000000-0000-4000-8000-00000000000f",
  calendarReminderA: "00000000-0000-4000-8000-000000000010",
  calendarReminderB: "00000000-0000-4000-8000-000000000011",
  calendarEventOperation: "00000000-0000-4000-8000-000000000012",
  calendarReminderOperation: "00000000-0000-4000-8000-000000000013",
};

async function expectFailure(name: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(`${name}: expected the SQLite statement to fail.`);
}

export async function verifyLocalDatabase(db: SqliteExecutor): Promise<void> {
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    await db.runAsync(
      `INSERT INTO pets (id, owner_id, name, species, created_at, updated_at)
       VALUES (?, ?, 'Verification pet', 'dog', ?, ?)`,
      ids.pet,
      ids.ownerA,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    const pet = await db.getFirstAsync<{ version: number }>(
      "SELECT version FROM pets WHERE id = ?",
      ids.pet,
    );
    if (pet?.version !== 0) {
      throw new Error("A locally created row must have server version 0.");
    }

    await expectFailure("canonical UUID validation", () =>
      db.runAsync(
        `INSERT INTO pets (id, owner_id, name, species, created_at, updated_at)
         VALUES (?, ?, 'Invalid UUID', 'dog', ?, ?)`,
        "x".repeat(36),
        ids.ownerA,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
    );

    await expectFailure("cross-owner health relation", () =>
      db.runAsync(
        `INSERT INTO health_records
          (id, owner_id, pet_id, record_type, title, occurred_at, created_at, updated_at)
         VALUES (?, ?, ?, 'observation', 'Owner isolation', ?, ?, ?)`,
        "00000000-0000-4000-8000-000000000007",
        ids.ownerB,
        ids.pet,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
    );
    await expectFailure("medical relation to a missing pet", () =>
      db.runAsync(
        `INSERT INTO health_records
          (id, owner_id, pet_id, record_type, title, occurred_at, created_at, updated_at)
         VALUES (?, ?, ?, 'observation', 'Missing pet', ?, ?, ?)`,
        "00000000-0000-4000-8000-00000000000b",
        ids.ownerA,
        "00000000-0000-4000-8000-00000000000c",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
    );
    await expectFailure("medical record UUID validation", () =>
      db.runAsync(
        `INSERT INTO health_records
          (id, owner_id, pet_id, record_type, title, occurred_at, created_at, updated_at)
         VALUES (?, ?, ?, 'observation', 'Invalid ID', ?, ?, ?)`,
        "not-a-uuid",
        ids.ownerA,
        ids.pet,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
    );

    await db.runAsync(
      `INSERT INTO health_records
        (id, owner_id, pet_id, record_type, record_subtype, title, occurred_at,
         clinic_name, observations, details_json, created_at, updated_at)
       VALUES (?, ?, ?, 'observation', 'exam', 'Verification exam', ?, 'Clinic',
         'Observed', '{}', ?, ?)`,
      ids.healthRecord,
      ids.ownerA,
      ids.pet,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    const exam = await db.getFirstAsync<{ record_subtype: string | null; version: number }>(
      "SELECT record_subtype, version FROM health_records WHERE id = ?",
      ids.healthRecord,
    );
    if (exam?.record_subtype !== "exam" || exam.version !== 0) {
      throw new Error("Medical exam subtypes and the initial server version must persist.");
    }
    await db.runAsync(
      "UPDATE health_records SET deleted_at = ?, updated_at = ? WHERE id = ?",
      "2026-01-02T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      ids.healthRecord,
    );
    const deletedRecord = await db.getFirstAsync<{ deleted_at: string | null; version: number }>(
      "SELECT deleted_at, version FROM health_records WHERE id = ?",
      ids.healthRecord,
    );
    if (!deletedRecord?.deleted_at || deletedRecord.version !== 0) {
      throw new Error("A local medical tombstone must preserve its known server version.");
    }

    await expectFailure("cross-owner medical attachment", () =>
      db.runAsync(
        `INSERT INTO health_attachments
          (id, owner_id, pet_id, health_record_id, storage_key, original_filename,
           mime_type, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'medical-files/test', 'report.pdf', 'application/pdf', 10, ?, ?)`,
        ids.healthAttachment,
        ids.ownerB,
        ids.pet,
        ids.healthRecord,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
    );

    await db.runAsync(
      "UPDATE pets SET deleted_at = ?, version = version + 1 WHERE id = ?",
      "2026-01-02T00:00:00.000Z",
      ids.pet,
    );
    const deletedPet = await db.getFirstAsync<{ deleted_at: string | null; version: number }>(
      "SELECT deleted_at, version FROM pets WHERE id = ?",
      ids.pet,
    );
    if (!deletedPet?.deleted_at || deletedPet.version !== 1) {
      throw new Error("Soft deletion must retain the row and increment its version.");
    }

    const queuedAt = "2026-01-01T00:00:00.000Z";
    for (const [operationId, accountId] of [
      [ids.operationA, ids.ownerA],
      [ids.operationB, ids.ownerB],
    ]) {
      await db.runAsync(
        `INSERT INTO sync_queue
          (operation_id, account_id, entity_type, entity_id, action, payload, created_at, updated_at)
         VALUES (?, ?, 'pet', ?, 'update', '{}', ?, ?)`,
        operationId,
        accountId,
        ids.pet,
        queuedAt,
        queuedAt,
      );
    }
    await db.runAsync(
      `INSERT INTO sync_queue
        (operation_id, account_id, entity_type, entity_id, action, payload, created_at, updated_at)
       VALUES (?, ?, 'health_record', ?, 'create', '{}', ?, ?)`,
      ids.healthOperation,
      ids.ownerA,
      ids.healthRecord,
      queuedAt,
      queuedAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
      ids.ownerA,
      ids.healthOperation,
      ids.operationA,
    );
    const healthDependencies = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM sync_queue_dependencies
       WHERE account_id = ? AND operation_id = ? AND depends_on_operation_id = ?`,
      ids.ownerA,
      ids.healthOperation,
      ids.operationA,
    );
    if (healthDependencies?.count !== 1) {
      throw new Error("A medical-record queue operation must depend on its pet operation.");
    }
    await db.runAsync(
      `INSERT INTO health_attachments
        (id, owner_id, pet_id, health_record_id, storage_key, original_filename,
         mime_type, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'medical-files/verification', 'report.pdf',
         'application/pdf', 10, ?, ?)`,
      ids.healthAttachment,
      ids.ownerA,
      ids.pet,
      ids.healthRecord,
      queuedAt,
      queuedAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue
        (operation_id, account_id, entity_type, entity_id, action, payload, created_at, updated_at)
       VALUES (?, ?, 'health_attachment', ?, 'create', '{}', ?, ?)`,
      ids.attachmentOperation,
      ids.ownerA,
      ids.healthAttachment,
      queuedAt,
      queuedAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
      ids.ownerA,
      ids.attachmentOperation,
      ids.healthOperation,
    );
    const dependencies = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM sync_queue_dependencies
       WHERE account_id = ? AND operation_id = ?`,
      ids.ownerA,
      ids.attachmentOperation,
    );
    if (dependencies?.count !== 1) {
      throw new Error("An attachment queue operation must depend on its medical record operation.");
    }

    await db.runAsync(
      `INSERT INTO care_tasks
        (id, owner_id, pet_id, task_type, category, title, recurrence_rule,
         timezone, starts_at, enabled, version, created_at, updated_at,
         schedule_json, next_run_at)
       VALUES (?, ?, ?, 'custom', 'exercise', 'Verification walk', '{"frequency":"daily"}',
         'America/Bogota', ?, 1, 0, ?, ?, '{"frequency":"daily","interval":1,"unit":"days"}', ?)`,
      ids.careTask,
      ids.ownerA,
      ids.pet,
      "2026-01-02T13:00:00.000Z",
      queuedAt,
      queuedAt,
      "2026-01-02T13:00:00.000Z",
    );
    await db.runAsync(
      `INSERT INTO care_task_executions
        (id, owner_id, task_id, pet_id, scheduled_for, executed_at, status,
         version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', 0, ?, ?)`,
      ids.careExecution,
      ids.ownerA,
      ids.careTask,
      ids.pet,
      "2026-01-02T13:00:00.000Z",
      "2026-01-02T13:05:00.000Z",
      queuedAt,
      queuedAt,
    );
    await expectFailure("cross-owner care task", () =>
      db.runAsync(
        `INSERT INTO care_tasks
          (id, owner_id, pet_id, task_type, category, title, recurrence_rule,
           timezone, starts_at, enabled, created_at, updated_at, schedule_json, next_run_at)
         VALUES ('00000000-0000-4000-8000-00000000000f', ?, ?, 'custom', 'custom',
           'Invalid owner task', '{}', 'UTC', ?, 1, ?, ?, '{}', ?)`,
        ids.ownerB,
        ids.pet,
        queuedAt,
        queuedAt,
        queuedAt,
        queuedAt,
      ),
    );
    await db.runAsync(
      `INSERT INTO sync_queue
        (operation_id, account_id, entity_type, entity_id, action, payload, created_at, updated_at)
       VALUES (?, ?, 'care_task', ?, 'create', '{}', ?, ?)`,
      ids.careTaskOperation,
      ids.ownerA,
      ids.careTask,
      queuedAt,
      queuedAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
      ids.ownerA,
      ids.careTaskOperation,
      ids.operationA,
    );
    await db.runAsync(
      `INSERT INTO sync_queue
        (operation_id, account_id, entity_type, entity_id, action, payload, created_at, updated_at)
       VALUES (?, ?, 'care_execution', ?, 'create', '{}', ?, ?)`,
      ids.careExecutionOperation,
      ids.ownerA,
      ids.careExecution,
      queuedAt,
      queuedAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
      ids.ownerA,
      ids.careExecutionOperation,
      ids.careTaskOperation,
    );
    const executionQueue = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM sync_queue_dependencies
       WHERE account_id = ? AND operation_id = ? AND depends_on_operation_id = ?`,
      ids.ownerA,
      ids.careExecutionOperation,
      ids.careTaskOperation,
    );
    if (executionQueue?.count !== 1) {
      throw new Error("A care execution queue operation must depend on its activity operation.");
    }

    await db.runAsync(
      `INSERT INTO calendar_events
        (id, owner_id, pet_id, title, category, starts_at, timezone, status, version, created_at, updated_at)
       VALUES (?, ?, ?, 'Verification event', 'custom', ?, 'America/Bogota', 'scheduled', 0, ?, ?)`,
      ids.calendarEvent,
      ids.ownerA,
      ids.pet,
      "2026-01-03T15:00:00.000Z",
      queuedAt,
      queuedAt,
    );
    for (const reminderId of [ids.calendarReminderA, ids.calendarReminderB]) {
      await db.runAsync(
        `INSERT INTO calendar_reminders
          (id, owner_id, pet_id, calendar_event_id, title, remind_at, lead_minutes,
           timezone, status, enabled, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Verification reminder', ?, 30, 'America/Bogota',
           'pending', 1, 0, ?, ?)`,
        reminderId,
        ids.ownerA,
        ids.pet,
        ids.calendarEvent,
        "2026-01-03T14:30:00.000Z",
        queuedAt,
        queuedAt,
      );
    }
    const multipleReminders = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM calendar_reminders
       WHERE owner_id = ? AND calendar_event_id = ? AND deleted_at IS NULL`,
      ids.ownerA,
      ids.calendarEvent,
    );
    if (multipleReminders?.count !== 2) {
      throw new Error("An event must support multiple independent reminders.");
    }
    await expectFailure("calendar reminder requires exactly one target", () =>
      db.runAsync(
        `INSERT INTO calendar_reminders
          (id, owner_id, pet_id, title, remind_at, timezone, created_at, updated_at)
         VALUES ('00000000-0000-4000-8000-000000000014', ?, ?, 'No target', ?, 'UTC', ?, ?)`,
        ids.ownerA,
        ids.pet,
        queuedAt,
        queuedAt,
        queuedAt,
      ),
    );
    await expectFailure("calendar event reminder must share the event pet", () =>
      db.runAsync(
        `INSERT INTO calendar_reminders
          (id, owner_id, calendar_event_id, title, remind_at, timezone, created_at, updated_at)
         VALUES ('00000000-0000-4000-8000-000000000016', ?, ?, 'Mismatched pet', ?, 'UTC', ?, ?)`,
        ids.ownerA,
        ids.calendarEvent,
        queuedAt,
        queuedAt,
        queuedAt,
      ),
    );
    await expectFailure("cross-owner calendar event pet", () =>
      db.runAsync(
        `INSERT INTO calendar_events
          (id, owner_id, pet_id, title, category, starts_at, timezone, created_at, updated_at)
         VALUES ('00000000-0000-4000-8000-000000000015', ?, ?, 'Invalid owner event', 'custom', ?, 'UTC', ?, ?)`,
        ids.ownerB,
        ids.pet,
        queuedAt,
        queuedAt,
        queuedAt,
      ),
    );
    await db.runAsync(
      `INSERT INTO sync_queue
        (operation_id, account_id, entity_type, entity_id, action, payload, created_at, updated_at)
       VALUES (?, ?, 'calendar_event', ?, 'create', '{}', ?, ?)`,
      ids.calendarEventOperation,
      ids.ownerA,
      ids.calendarEvent,
      queuedAt,
      queuedAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue
        (operation_id, account_id, entity_type, entity_id, action, payload, created_at, updated_at)
       VALUES (?, ?, 'calendar_reminder', ?, 'create', '{}', ?, ?)`,
      ids.calendarReminderOperation,
      ids.ownerA,
      ids.calendarReminderA,
      queuedAt,
      queuedAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
      ids.ownerA,
      ids.calendarReminderOperation,
      ids.calendarEventOperation,
    );
    const calendarDependencies = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM sync_queue_dependencies
       WHERE account_id = ? AND operation_id = ? AND depends_on_operation_id = ?`,
      ids.ownerA,
      ids.calendarReminderOperation,
      ids.calendarEventOperation,
    );
    if (calendarDependencies?.count !== 1) {
      throw new Error("A calendar reminder queue operation must depend on its event operation.");
    }
    await expectFailure("cross-account queue dependency", () =>
      db.runAsync(
        `INSERT INTO sync_queue_dependencies
          (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
        ids.ownerA,
        ids.operationA,
        ids.operationB,
      ),
    );
    await expectFailure("cross-account conflict reference", () =>
      db.runAsync(
        `INSERT INTO sync_conflicts
          (id, account_id, operation_id, entity_type, entity_id, base_version,
           server_version, local_snapshot, server_snapshot, conflicting_fields, created_at)
         VALUES (?, ?, ?, 'pet', ?, 0, 1, '{}', '{}', '[]', ?)`,
        ids.conflict,
        ids.ownerA,
        ids.operationB,
        ids.pet,
        queuedAt,
      ),
    );

    const foreignKeyErrors = await db.getFirstAsync<{ count: number }>(
      "SELECT count(*) AS count FROM pragma_foreign_key_check",
    );
    if (foreignKeyErrors?.count !== 0) {
      throw new Error("SQLite foreign_key_check returned violations.");
    }
  } finally {
    await db.execAsync("ROLLBACK");
  }
}
