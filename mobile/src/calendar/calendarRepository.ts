import * as Crypto from "expo-crypto";
import { getLocalAccountId, withLocalWriteTransaction } from "../db/localAccount";
import { getPetCareDatabase } from "../db/database";
import { isoToLocalDateTime, localDateTimeToIso } from "../care/recurrence";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarFilters,
  CalendarItem,
  CalendarPetOption,
  CalendarReminder,
  CalendarReminderInput,
} from "./types";

type EventRow = CalendarEvent;
type ReminderRow = Omit<CalendarReminder, "scheduling_status" | "last_error"> & {
  scheduling_status?: CalendarReminder["scheduling_status"];
  last_error?: string | null;
};

const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const localDay = (value: string, timezone = deviceTimezone()) => isoToLocalDateTime(value, timezone).slice(0, 10);

function dayFromDate(value: string): string {
  return value.slice(0, 10);
}

function eventPayload(event: CalendarEvent): string {
  return JSON.stringify(event);
}

async function latestOperation(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const row = await tx.getFirstAsync<{ operation_id: string }>(
    `SELECT operation_id FROM sync_queue
     WHERE account_id = ? AND entity_type = ? AND entity_id = ?
     ORDER BY rowid DESC LIMIT 1`,
    ownerId,
    entityType,
    entityId,
  );
  return row?.operation_id ?? null;
}

async function queueOperation(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  entityType: "calendar_event" | "calendar_reminder" | "appointment",
  entityId: string,
  action: "create" | "update" | "delete",
  payload: string,
  baseVersion: number,
  fields: string[],
  dependencies: (string | null)[],
): Promise<string> {
  const operationId = Crypto.randomUUID().toLowerCase();
  const now = new Date().toISOString();
  await tx.runAsync(
    `INSERT INTO sync_queue
      (operation_id, account_id, entity_type, entity_id, action, payload,
       base_version, changed_fields, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    operationId, ownerId, entityType, entityId, action, payload, baseVersion,
    JSON.stringify(fields), now, now,
  );
  for (const dependency of new Set(dependencies.filter((value): value is string => Boolean(value)))) {
    if (dependency === operationId) continue;
    await tx.runAsync(
      `INSERT OR IGNORE INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
      ownerId, operationId, dependency,
    );
  }
  await tx.runAsync("UPDATE sync_metadata SET updated_at = ? WHERE account_id = ?", now, ownerId);
  return operationId;
}

async function petOperation(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  petId: string | null,
): Promise<string | null> {
  return petId ? latestOperation(tx, ownerId, "pet", petId) : null;
}

async function assertPet(tx: Awaited<ReturnType<typeof getPetCareDatabase>>, ownerId: string, petId: string): Promise<void> {
  const pet = await tx.getFirstAsync<{ id: string }>(
    "SELECT id FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
    ownerId, petId,
  );
  if (!pet) throw new Error("La mascota no existe o no pertenece a esta cuenta.");
}

function item(
  source: CalendarItem["source"],
  sourceId: string,
  title: string,
  description: string | null,
  category: string,
  status: string,
  startsAt: string,
  endsAt: string | null,
  timezone: string,
  petId: string | null,
  petName: string | null,
  allDay = false,
  targetId = sourceId,
): CalendarItem {
  return {
    id: `${source}:${sourceId}`,
    source,
    sourceId,
    title,
    description,
    category,
    status,
    startsAt,
    endsAt,
    day: allDay ? dayFromDate(startsAt) : localDay(startsAt),
    timezone,
    petId,
    petName,
    allDay,
    targetId,
  };
}

export const calendarRepository = {
  async pets(): Promise<CalendarPetOption[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    return db.getAllAsync<CalendarPetOption>(
      "SELECT id, name FROM pets WHERE owner_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE",
      ownerId,
    );
  },

  async listItems(startDay: string, endDay: string, filters: CalendarFilters): Promise<CalendarItem[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const start = new Date(`${startDay}T00:00:00`).toISOString();
    const end = new Date(`${endDay}T23:59:59.999`).toISOString();
    const petId = filters.petId;
    const petJoin = `LEFT JOIN pets ON pets.owner_id = source.owner_id AND pets.id = source.pet_id`;
    const all: CalendarItem[] = [];

    const events = await db.getAllAsync<EventRow & { pet_name: string | null }>(
      `SELECT source.*, pets.name AS pet_name FROM calendar_events source ${petJoin}
       WHERE source.owner_id = ? AND source.deleted_at IS NULL
         AND source.starts_at >= ? AND source.starts_at <= ?
         AND (? IS NULL OR source.pet_id = ?)`,
      ownerId, start, end, petId, petId,
    );
    for (const event of events) {
      all.push(item("calendar_event", event.id, event.title, event.description, event.category,
        event.status, event.starts_at, event.ends_at, event.timezone, event.pet_id, event.pet_name));
    }

    const appointments = await db.getAllAsync<{
      id: string; pet_id: string; pet_name: string; title: string; notes: string | null;
      starts_at: string; ends_at: string | null; status: string;
    }>(
      `SELECT appointments.*, pets.name AS pet_name FROM appointments
       JOIN pets ON pets.owner_id = appointments.owner_id AND pets.id = appointments.pet_id
       WHERE appointments.owner_id = ? AND appointments.deleted_at IS NULL
         AND appointments.starts_at >= ? AND appointments.starts_at <= ?
         AND (? IS NULL OR appointments.pet_id = ?)`,
      ownerId, start, end, petId, petId,
    );
    for (const appointment of appointments) {
      all.push(item("appointment", appointment.id, appointment.title, appointment.notes,
        "veterinary_appointment", appointment.status, appointment.starts_at, appointment.ends_at,
        deviceTimezone(), appointment.pet_id, appointment.pet_name));
    }

    const careTasks = await db.getAllAsync<{
      id: string; pet_id: string; pet_name: string; title: string; description: string | null;
      category: string; next_run_at: string; timezone: string;
    }>(
      `SELECT care_tasks.id, care_tasks.pet_id, pets.name AS pet_name, care_tasks.title,
         care_tasks.description, care_tasks.category, care_tasks.next_run_at, care_tasks.timezone
       FROM care_tasks JOIN pets
         ON pets.owner_id = care_tasks.owner_id AND pets.id = care_tasks.pet_id
       WHERE care_tasks.owner_id = ? AND care_tasks.deleted_at IS NULL AND pets.deleted_at IS NULL
         AND care_tasks.enabled = 1 AND care_tasks.next_run_at >= ? AND care_tasks.next_run_at <= ?
         AND (? IS NULL OR care_tasks.pet_id = ?)`,
      ownerId, start, end, petId, petId,
    );
    for (const task of careTasks) {
      all.push(item("care_task", task.id, task.title, task.description, task.category,
        task.next_run_at < new Date().toISOString() ? "overdue" : "pending",
        task.next_run_at, null, task.timezone, task.pet_id, task.pet_name));
    }

    const executions = await db.getAllAsync<{
      id: string; task_id: string; pet_id: string; pet_name: string; title: string;
      category: string; scheduled_for: string; executed_at: string | null; status: string; timezone: string;
    }>(
      `SELECT care_task_executions.id, care_task_executions.task_id, care_task_executions.pet_id,
         pets.name AS pet_name, care_tasks.title, care_tasks.category,
         care_task_executions.scheduled_for, care_task_executions.executed_at,
         care_task_executions.status, care_tasks.timezone
       FROM care_task_executions
       JOIN care_tasks ON care_tasks.owner_id = care_task_executions.owner_id
         AND care_tasks.id = care_task_executions.task_id
       JOIN pets ON pets.owner_id = care_task_executions.owner_id AND pets.id = care_task_executions.pet_id
       WHERE care_task_executions.owner_id = ? AND care_task_executions.deleted_at IS NULL
         AND COALESCE(care_task_executions.executed_at, care_task_executions.scheduled_for) >= ?
         AND COALESCE(care_task_executions.executed_at, care_task_executions.scheduled_for) <= ?
         AND (? IS NULL OR care_task_executions.pet_id = ?)`,
      ownerId, start, end, petId, petId,
    );
    for (const execution of executions) {
      all.push(item("care_execution", execution.id, execution.title, null, execution.category,
        execution.status, execution.executed_at ?? execution.scheduled_for, null, execution.timezone,
        execution.pet_id, execution.pet_name, false, execution.task_id));
    }

    const health = await db.getAllAsync<{
      id: string; pet_id: string; pet_name: string; title: string; description: string | null;
      record_type: string; record_subtype: string | null; next_event_at: string;
    }>(
      `SELECT health_records.id, health_records.pet_id, pets.name AS pet_name, health_records.title,
         health_records.description, health_records.record_type, health_records.record_subtype,
         health_records.next_event_at
       FROM health_records JOIN pets
         ON pets.owner_id = health_records.owner_id AND pets.id = health_records.pet_id
       WHERE health_records.owner_id = ? AND health_records.deleted_at IS NULL
         AND pets.deleted_at IS NULL AND health_records.next_event_at >= ?
         AND health_records.next_event_at <= ? AND (? IS NULL OR health_records.pet_id = ?)`,
      ownerId, startDay, endDay, petId, petId,
    );
    for (const record of health) {
      const category = record.record_subtype === "exam" ? "examination" : record.record_type;
      all.push(item("health_record", record.id, record.title, record.description, category,
        "scheduled", record.next_event_at, null, deviceTimezone(), record.pet_id, record.pet_name, true));
    }

    const reminders = await db.getAllAsync<{
      id: string; pet_id: string | null; pet_name: string | null; title: string; notes: string | null;
      remind_at: string; status: string; timezone: string; enabled: number;
    }>(
      `SELECT calendar_reminders.id, calendar_reminders.pet_id, pets.name AS pet_name,
         calendar_reminders.title, calendar_reminders.notes, calendar_reminders.remind_at,
         calendar_reminders.status, calendar_reminders.timezone, calendar_reminders.enabled
       FROM calendar_reminders LEFT JOIN pets
         ON pets.owner_id = calendar_reminders.owner_id AND pets.id = calendar_reminders.pet_id
       WHERE calendar_reminders.owner_id = ? AND calendar_reminders.deleted_at IS NULL
         AND calendar_reminders.remind_at >= ? AND calendar_reminders.remind_at <= ?
         AND (? IS NULL OR calendar_reminders.pet_id = ?)`,
      ownerId, start, end, petId, petId,
    );
    for (const reminder of reminders) {
      all.push(item("calendar_reminder", reminder.id, reminder.title, reminder.notes,
        "reminder", reminder.enabled ? reminder.status : "disabled", reminder.remind_at, null,
        reminder.timezone, reminder.pet_id, reminder.pet_name));
    }

    return all
      .filter((entry) => filters.category === "" || entry.category === filters.category)
      .filter((entry) => filters.status === "" || entry.status === filters.status)
      .filter((entry) => filters.type === "" || entry.source === filters.type)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.title.localeCompare(right.title));
  },

  async getEvent(id: string): Promise<{ event: CalendarEvent; reminders: CalendarReminder[] } | null> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const event = await db.getFirstAsync<EventRow>(
      "SELECT * FROM calendar_events WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
      ownerId, id,
    );
    if (!event) return null;
    const reminders = await db.getAllAsync<ReminderRow>(
      `SELECT calendar_reminders.*, COALESCE(calendar_scheduled_notifications.scheduling_status, 'pending') AS scheduling_status,
         calendar_scheduled_notifications.last_error
       FROM calendar_reminders LEFT JOIN calendar_scheduled_notifications
         ON calendar_scheduled_notifications.reminder_id = calendar_reminders.id
       WHERE calendar_reminders.owner_id = ? AND calendar_reminders.calendar_event_id = ?
         AND calendar_reminders.deleted_at IS NULL ORDER BY calendar_reminders.remind_at`,
      ownerId, id,
    );
    return { event, reminders: reminders.map((reminder) => ({
      ...reminder, scheduling_status: reminder.scheduling_status ?? "pending",
      last_error: reminder.last_error ?? null,
    })) };
  },

  async targetInfo(kind: CalendarReminderInput["target"]["kind"], id: string): Promise<{
    title: string; startsAt: string | null; timezone: string; petId: string | null;
  }> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const source = kind === "calendar_event" ? "calendar_events"
      : kind === "care_task" ? "care_tasks"
        : kind === "appointment" ? "appointments" : "health_records";
    const startColumn = kind === "calendar_event" || kind === "appointment" ? "starts_at"
      : kind === "care_task" ? "next_run_at" : "next_event_at";
    const row = await db.getFirstAsync<{ title: string; starts_at: string | null; pet_id: string | null; timezone?: string }>(
      `SELECT title, ${startColumn} AS starts_at, pet_id${kind === "care_task" || kind === "calendar_event" ? ", timezone" : ""}
       FROM ${source} WHERE owner_id = ? AND id = ?`,
      ownerId, id,
    );
    if (!row) throw new Error("No encontramos el evento asociado al recordatorio.");
    return {
      title: row.title,
      startsAt: row.starts_at,
      timezone: row.timezone ?? deviceTimezone(),
      petId: row.pet_id,
    };
  },

  async saveEvent(input: CalendarEventInput, id?: string): Promise<CalendarEvent> {
    if (!input.title.trim()) throw new Error("El título es obligatorio.");
    if (!input.timezone.trim()) throw new Error("Selecciona una zona horaria válida.");
    if (input.endsAt && input.endsAt <= input.startsAt) throw new Error("La fecha de fin debe ser posterior al inicio.");
    return withLocalWriteTransaction(async (tx, ownerId) => {
      if (input.petId) await assertPet(tx, ownerId, input.petId);
      const now = new Date().toISOString();
      let action: "create" | "update";
      if (id) {
        const existing = await tx.getFirstAsync<EventRow>(
          "SELECT * FROM calendar_events WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
          ownerId, id,
        );
        if (!existing) throw new Error("No encontramos este evento.");
        await tx.runAsync(
          `UPDATE calendar_events SET pet_id = ?, title = ?, description = ?, category = ?,
            starts_at = ?, ends_at = ?, timezone = ?, status = ?, observations = ?, updated_at = ?
           WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`,
          input.petId, input.title.trim(), input.description.trim() || null, input.category,
          input.startsAt, input.endsAt, input.timezone, input.status, input.observations.trim() || null,
          now, ownerId, id,
        );
        action = "update";
      } else {
        id = Crypto.randomUUID().toLowerCase();
        await tx.runAsync(
          `INSERT INTO calendar_events
            (id, owner_id, pet_id, title, description, category, starts_at, ends_at,
             timezone, status, observations, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          id, ownerId, input.petId, input.title.trim(), input.description.trim() || null,
          input.category, input.startsAt, input.endsAt, input.timezone, input.status,
          input.observations.trim() || null, now, now,
        );
        action = "create";
      }
      const saved = await tx.getFirstAsync<EventRow>(
        "SELECT * FROM calendar_events WHERE owner_id = ? AND id = ?",
        ownerId, id,
      );
      if (!saved) throw new Error("No se pudo leer el evento guardado.");
      const prior = await latestOperation(tx, ownerId, "calendar_event", id);
      const petOp = await petOperation(tx, ownerId, input.petId);
      await queueOperation(tx, ownerId, "calendar_event", id, action, eventPayload(saved),
        saved.version, ["pet_id", "title", "description", "category", "starts_at", "ends_at", "timezone", "status", "observations"],
        [petOp, prior]);
      return saved;
    });
  },

  async deleteEvent(id: string): Promise<string[]> {
    return withLocalWriteTransaction(async (tx, ownerId) => {
      const event = await tx.getFirstAsync<EventRow>(
        "SELECT * FROM calendar_events WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId, id,
      );
      if (!event) throw new Error("No encontramos este evento o ya fue eliminado.");
      const now = new Date().toISOString();
      await tx.runAsync(
        "UPDATE calendar_events SET deleted_at = ?, status = 'cancelled', updated_at = ? WHERE owner_id = ? AND id = ?",
        now, now, ownerId, id,
      );
      const deleted = { ...event, deleted_at: now, status: "cancelled" as const, updated_at: now };
      const prior = await latestOperation(tx, ownerId, "calendar_event", id);
      await queueOperation(tx, ownerId, "calendar_event", id, "delete", eventPayload(deleted),
        event.version, ["deleted_at", "status"], [prior, await petOperation(tx, ownerId, event.pet_id)]);
      const reminders = await tx.getAllAsync<{ id: string; version: number; pet_id: string | null }>(
        `SELECT id, version, pet_id FROM calendar_reminders
         WHERE owner_id = ? AND calendar_event_id = ? AND deleted_at IS NULL AND status = 'pending'`,
        ownerId, id,
      );
      for (const reminder of reminders) {
        await tx.runAsync(
          `UPDATE calendar_reminders SET status = 'cancelled', enabled = 0, updated_at = ?
           WHERE owner_id = ? AND id = ?`,
          now, ownerId, reminder.id,
        );
        const removed = { ...reminder, status: "cancelled", enabled: 0, updated_at: now };
        const previous = await latestOperation(tx, ownerId, "calendar_reminder", reminder.id);
        await queueOperation(tx, ownerId, "calendar_reminder", reminder.id, "update",
          JSON.stringify(removed), reminder.version, ["status", "enabled"],
          [previous, await latestOperation(tx, ownerId, "calendar_event", id)]);
      }
      return reminders.map((reminder) => reminder.id);
    });
  },

  async saveAppointment(input: {
    petId: string; title: string; startsAt: string; endsAt: string | null;
    location: string; notes: string; status: "scheduled" | "completed" | "cancelled";
  }, id?: string) {
    if (!input.title.trim()) throw new Error("El título de la cita es obligatorio.");
    return withLocalWriteTransaction(async (tx, ownerId) => {
      await assertPet(tx, ownerId, input.petId);
      const now = new Date().toISOString();
      if (id) {
        const current = await tx.getFirstAsync<{ version: number }>(
          "SELECT version FROM appointments WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
          ownerId, id,
        );
        if (!current) throw new Error("No encontramos esta cita.");
        await tx.runAsync(
          `UPDATE appointments SET pet_id = ?, title = ?, starts_at = ?, ends_at = ?,
             location = ?, notes = ?, status = ?, updated_at = ?
           WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`,
          input.petId, input.title.trim(), input.startsAt, input.endsAt, input.location.trim() || null,
          input.notes.trim() || null, input.status, now, ownerId, id,
        );
      } else {
        id = Crypto.randomUUID().toLowerCase();
        await tx.runAsync(
          `INSERT INTO appointments
            (id, owner_id, pet_id, title, starts_at, ends_at, location, notes, status, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          id, ownerId, input.petId, input.title.trim(), input.startsAt, input.endsAt,
          input.location.trim() || null, input.notes.trim() || null, input.status, now, now,
        );
      }
      const row = await tx.getFirstAsync<{ id: string; pet_id: string; title: string; starts_at: string; ends_at: string | null; location: string | null; notes: string | null; status: string; version: number; created_at: string; updated_at: string; deleted_at: string | null }>(
        "SELECT * FROM appointments WHERE owner_id = ? AND id = ?",
        ownerId, id,
      );
      if (!row) throw new Error("No se pudo leer la cita guardada.");
      const previous = await latestOperation(tx, ownerId, "appointment", id);
      await queueOperation(tx, ownerId, "appointment", id, previous ? "update" : "create",
        JSON.stringify({ ...row, owner_id: ownerId }), row.version,
        ["pet_id", "title", "starts_at", "ends_at", "location", "notes", "status"],
        [previous, await petOperation(tx, ownerId, input.petId)]);
      return row;
    });
  },

  async getAppointment(id: string) {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const appointment = await db.getFirstAsync<{
      id: string; owner_id: string; pet_id: string; title: string; starts_at: string;
      ends_at: string | null; location: string | null; notes: string | null; status: string;
      version: number; created_at: string; updated_at: string; deleted_at: string | null; pet_name: string;
    }>(
      `SELECT appointments.*, pets.name AS pet_name FROM appointments
       JOIN pets ON pets.owner_id = appointments.owner_id AND pets.id = appointments.pet_id
       WHERE appointments.owner_id = ? AND appointments.id = ? AND appointments.deleted_at IS NULL`,
      ownerId, id,
    );
    if (!appointment) return null;
    const reminders = await this.listRemindersForTarget({ kind: "appointment", id });
    return { appointment, reminders };
  },

  async deleteAppointment(id: string): Promise<string[]> {
    return withLocalWriteTransaction(async (tx, ownerId) => {
      const appointment = await tx.getFirstAsync<{
        id: string; pet_id: string; title: string; starts_at: string; ends_at: string | null;
        location: string | null; notes: string | null; status: string; version: number;
        created_at: string; updated_at: string; deleted_at: string | null;
      }>(
        "SELECT * FROM appointments WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId, id,
      );
      if (!appointment) throw new Error("No encontramos esta cita o ya fue eliminada.");
      const now = new Date().toISOString();
      await tx.runAsync(
        "UPDATE appointments SET deleted_at = ?, status = 'cancelled', updated_at = ? WHERE owner_id = ? AND id = ?",
        now, now, ownerId, id,
      );
      const deleted = { ...appointment, deleted_at: now, status: "cancelled", updated_at: now, owner_id: ownerId };
      const previous = await latestOperation(tx, ownerId, "appointment", id);
      await queueOperation(tx, ownerId, "appointment", id, "delete", JSON.stringify(deleted),
        appointment.version, ["deleted_at", "status"], [previous, await petOperation(tx, ownerId, appointment.pet_id)]);
      const reminders = await tx.getAllAsync<{ id: string; version: number }>(
        `SELECT id, version FROM calendar_reminders
         WHERE owner_id = ? AND appointment_id = ? AND deleted_at IS NULL AND status = 'pending'`,
        ownerId, id,
      );
      for (const reminder of reminders) {
        await tx.runAsync(
          "UPDATE calendar_reminders SET status = 'cancelled', enabled = 0, updated_at = ? WHERE owner_id = ? AND id = ?",
          now, ownerId, reminder.id,
        );
        await queueOperation(tx, ownerId, "calendar_reminder", reminder.id, "update",
          JSON.stringify({ ...reminder, owner_id: ownerId, status: "cancelled", enabled: 0, updated_at: now }),
          reminder.version, ["status", "enabled"],
          [await latestOperation(tx, ownerId, "appointment", id), await latestOperation(tx, ownerId, "calendar_reminder", reminder.id)]);
        await tx.runAsync(
          `INSERT INTO calendar_scheduled_notifications (reminder_id, scheduling_status, updated_at)
           VALUES (?, 'disabled', ?)
           ON CONFLICT(reminder_id) DO UPDATE SET operating_system_id = NULL, scheduled_for = NULL,
             scheduling_status = 'disabled', last_error = NULL, updated_at = excluded.updated_at`,
          reminder.id, now,
        );
      }
      return reminders.map((reminder) => reminder.id);
    });
  },

  async listRemindersForTarget(target: CalendarReminderInput["target"]): Promise<CalendarReminder[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const targetColumn = target.kind === "calendar_event" ? "calendar_event_id"
      : target.kind === "care_task" ? "care_task_id"
        : target.kind === "appointment" ? "appointment_id" : "health_record_id";
    const rows = await db.getAllAsync<ReminderRow>(
      `SELECT calendar_reminders.*, COALESCE(calendar_scheduled_notifications.scheduling_status, 'pending') AS scheduling_status,
         calendar_scheduled_notifications.last_error
       FROM calendar_reminders LEFT JOIN calendar_scheduled_notifications
         ON calendar_scheduled_notifications.reminder_id = calendar_reminders.id
       WHERE calendar_reminders.owner_id = ? AND calendar_reminders.${targetColumn} = ?
         AND calendar_reminders.deleted_at IS NULL ORDER BY calendar_reminders.remind_at`,
      ownerId, target.id,
    );
    return rows.map((row) => ({ ...row, scheduling_status: row.scheduling_status ?? "pending", last_error: row.last_error ?? null }));
  },

  async refreshRelativeReminders(target: CalendarReminderInput["target"]): Promise<CalendarReminder[]> {
    return withLocalWriteTransaction(async (tx, ownerId) => {
      const sourceTable = target.kind === "calendar_event" ? "calendar_events"
        : target.kind === "care_task" ? "care_tasks"
          : target.kind === "appointment" ? "appointments" : "health_records";
      const startColumn = target.kind === "calendar_event" || target.kind === "appointment" ? "starts_at"
        : target.kind === "care_task" ? "next_run_at" : "next_event_at";
      const source = await tx.getFirstAsync<{
        starts_at: string | null; pet_id: string | null; timezone: string | null; enabled?: number; status?: string;
      }>(
        `SELECT ${startColumn} AS starts_at, pet_id${target.kind === "calendar_event" || target.kind === "care_task" ? ", timezone" : ""}
         ${target.kind === "care_task" ? ", enabled" : ""}
         ${target.kind === "calendar_event" || target.kind === "appointment" ? ", status" : ""}
         FROM ${sourceTable} WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`,
        ownerId, target.id,
      );
      let startAt = source?.starts_at ?? null;
      if (target.kind === "care_task" && source?.enabled === 0) startAt = null;
      if ((target.kind === "calendar_event" || target.kind === "appointment")
        && (source?.status === "cancelled" || source?.status === "completed")) startAt = null;
      const reminders = await tx.getAllAsync<ReminderRow>(
        `SELECT * FROM calendar_reminders
         WHERE owner_id = ? AND ${target.kind === "calendar_event" ? "calendar_event_id"
          : target.kind === "care_task" ? "care_task_id"
            : target.kind === "appointment" ? "appointment_id" : "health_record_id"} = ?
           AND lead_minutes IS NOT NULL AND status = 'pending' AND enabled = 1 AND deleted_at IS NULL`,
        ownerId, target.id,
      );
      const refreshed: CalendarReminder[] = [];
      const now = new Date().toISOString();
      const parentOperation = await latestOperation(tx, ownerId, target.kind, target.id);
      for (const reminder of reminders) {
        let status: "pending" | "cancelled" = "pending";
        let enabled = 1;
        let remindAt: string | null = null;
        if (startAt) {
          const targetStart = target.kind === "health_record"
            ? localDateTimeToIso(`${startAt.slice(0, 10)}T09:00`, reminder.timezone)
            : new Date(startAt).toISOString();
          remindAt = new Date(new Date(targetStart).getTime() - (reminder.lead_minutes ?? 0) * 60_000).toISOString();
        } else {
          status = "cancelled";
          enabled = 0;
        }
        await tx.runAsync(
          `UPDATE calendar_reminders SET remind_at = COALESCE(?, remind_at), status = ?,
             enabled = ?, updated_at = ? WHERE owner_id = ? AND id = ?`,
          remindAt, status, enabled, now, ownerId, reminder.id,
        );
        const previous = await latestOperation(tx, ownerId, "calendar_reminder", reminder.id);
        const updated = {
          ...reminder, remind_at: remindAt ?? reminder.remind_at, status, enabled, updated_at: now,
          owner_id: ownerId,
        };
        await queueOperation(tx, ownerId, "calendar_reminder", reminder.id, "update",
          JSON.stringify(updated), reminder.version, ["remind_at", "status", "enabled"],
          [previous, parentOperation, await petOperation(tx, ownerId, reminder.pet_id)]);
        const notificationState = status === "pending" ? "pending" : "disabled";
        await tx.runAsync(
          `INSERT INTO calendar_scheduled_notifications (reminder_id, scheduling_status, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(reminder_id) DO UPDATE SET operating_system_id = NULL, scheduled_for = NULL,
             scheduling_status = excluded.scheduling_status, last_error = NULL, updated_at = excluded.updated_at`,
          reminder.id, notificationState, now,
        );
        refreshed.push({
          ...updated,
          scheduling_status: notificationState,
          last_error: null,
        });
      }
      return refreshed;
    });
  },

  async saveReminder(input: CalendarReminderInput, id?: string): Promise<CalendarReminder> {
    if (!input.title.trim()) throw new Error("El título del recordatorio es obligatorio.");
    if (input.leadMinutes !== null && (!Number.isInteger(input.leadMinutes) || input.leadMinutes < 0)) {
      throw new Error("La anticipación debe ser cero o un número entero positivo.");
    }
    return withLocalWriteTransaction(async (tx, ownerId) => {
      const columns = {
        calendar_event: "calendar_event_id",
        care_task: "care_task_id",
        appointment: "appointment_id",
        health_record: "health_record_id",
      } as const;
      const sourceColumn = columns[input.target.kind];
      const target = await tx.getFirstAsync<{ id: string; pet_id?: string | null; owner_id: string }>(
        `SELECT id, owner_id, ${input.target.kind === "calendar_event" ? "pet_id" : "pet_id"} FROM ${input.target.kind === "calendar_event" ? "calendar_events" : input.target.kind === "care_task" ? "care_tasks" : input.target.kind === "appointment" ? "appointments" : "health_records"}
         WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`,
        ownerId, input.target.id,
      );
      if (!target) throw new Error("No encontramos el evento al que pertenece este recordatorio.");
      const petId = target.pet_id ?? null;
      const now = new Date().toISOString();
      let action: "create" | "update";
      if (id) {
        const existing = await tx.getFirstAsync<ReminderRow>(
          "SELECT * FROM calendar_reminders WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
          ownerId, id,
        );
        if (!existing) throw new Error("No encontramos este recordatorio.");
        await tx.runAsync(
          `UPDATE calendar_reminders SET pet_id = ?, ${sourceColumn} = ?, title = ?, remind_at = ?,
             lead_minutes = ?, timezone = ?, status = 'pending', enabled = 1, notes = ?, updated_at = ?
           WHERE owner_id = ? AND id = ?`,
          petId, input.target.id, input.title.trim(), input.remindAt, input.leadMinutes,
          input.timezone, input.notes.trim() || null, now, ownerId, id,
        );
        action = "update";
      } else {
        id = Crypto.randomUUID().toLowerCase();
        await tx.runAsync(
          `INSERT INTO calendar_reminders
            (id, owner_id, pet_id, ${sourceColumn}, title, remind_at, lead_minutes, timezone,
             status, enabled, notes, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, 0, ?, ?)`,
          id, ownerId, petId, input.target.id, input.title.trim(), input.remindAt,
          input.leadMinutes, input.timezone, input.notes.trim() || null, now, now,
        );
        action = "create";
      }
      const saved = await tx.getFirstAsync<ReminderRow>(
        "SELECT * FROM calendar_reminders WHERE owner_id = ? AND id = ?",
        ownerId, id,
      );
      if (!saved) throw new Error("No se pudo leer el recordatorio guardado.");
      const prior = await latestOperation(tx, ownerId, "calendar_reminder", id);
      const parentOperation = await latestOperation(tx, ownerId, input.target.kind, input.target.id);
      const petOp = await petOperation(tx, ownerId, petId);
      await queueOperation(tx, ownerId, "calendar_reminder", id, action,
        JSON.stringify({ ...saved, owner_id: ownerId }), saved.version,
        ["target", "title", "remind_at", "lead_minutes", "timezone", "notes", "enabled", "status"],
        [petOp, parentOperation, prior]);
      await tx.runAsync(
        `INSERT INTO calendar_scheduled_notifications
          (reminder_id, scheduling_status, updated_at) VALUES (?, 'pending', ?)
         ON CONFLICT(reminder_id) DO UPDATE SET
           operating_system_id = NULL, scheduled_for = NULL, scheduling_status = 'pending',
           last_error = NULL, updated_at = excluded.updated_at`,
        id, now,
      );
      return { ...saved, owner_id: ownerId, scheduling_status: "pending", last_error: null };
    });
  },

  async getReminder(id: string): Promise<CalendarReminder | null> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const row = await db.getFirstAsync<ReminderRow>(
      `SELECT calendar_reminders.*, COALESCE(calendar_scheduled_notifications.scheduling_status, 'pending') AS scheduling_status,
         calendar_scheduled_notifications.last_error
       FROM calendar_reminders LEFT JOIN calendar_scheduled_notifications
         ON calendar_scheduled_notifications.reminder_id = calendar_reminders.id
       WHERE calendar_reminders.owner_id = ? AND calendar_reminders.id = ? AND calendar_reminders.deleted_at IS NULL`,
      ownerId, id,
    );
    return row ? { ...row, scheduling_status: row.scheduling_status ?? "pending", last_error: row.last_error ?? null } : null;
  },

  async listReminders(): Promise<CalendarReminder[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const rows = await db.getAllAsync<ReminderRow>(
      `SELECT calendar_reminders.*, COALESCE(calendar_scheduled_notifications.scheduling_status, 'pending') AS scheduling_status,
         calendar_scheduled_notifications.last_error
       FROM calendar_reminders LEFT JOIN calendar_scheduled_notifications
         ON calendar_scheduled_notifications.reminder_id = calendar_reminders.id
       WHERE calendar_reminders.owner_id = ? AND calendar_reminders.deleted_at IS NULL
       ORDER BY calendar_reminders.remind_at`,
      ownerId,
    );
    return rows.map((row) => ({ ...row, scheduling_status: row.scheduling_status ?? "pending", last_error: row.last_error ?? null }));
  },

  async updateReminder(id: string, changes: { status?: "pending" | "attended" | "cancelled"; enabled?: boolean; deleted?: boolean }): Promise<CalendarReminder> {
    return withLocalWriteTransaction(async (tx, ownerId) => {
      const current = await tx.getFirstAsync<ReminderRow>(
        "SELECT * FROM calendar_reminders WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId, id,
      );
      if (!current) throw new Error("No encontramos este recordatorio.");
      const now = new Date().toISOString();
      const status = changes.status ?? current.status;
      const enabled = changes.enabled === undefined ? current.enabled : Number(changes.enabled);
      const deletedAt = changes.deleted ? now : current.deleted_at;
      await tx.runAsync(
        `UPDATE calendar_reminders SET status = ?, enabled = ?, deleted_at = ?, updated_at = ?
         WHERE owner_id = ? AND id = ?`,
        status, enabled, deletedAt, now, ownerId, id,
      );
      const updated = { ...current, status, enabled, deleted_at: deletedAt, updated_at: now };
      const previous = await latestOperation(tx, ownerId, "calendar_reminder", id);
      const targetColumn = current.calendar_event_id ? ["calendar_event", current.calendar_event_id]
        : current.care_task_id ? ["care_task", current.care_task_id]
          : current.appointment_id ? ["appointment", current.appointment_id]
            : ["health_record", current.health_record_id ?? ""];
      await queueOperation(tx, ownerId, "calendar_reminder", id, changes.deleted ? "delete" : "update",
        JSON.stringify({ ...updated, owner_id: ownerId }), current.version,
        ["status", "enabled", "deleted_at"], [
          previous,
          await petOperation(tx, ownerId, current.pet_id),
          await latestOperation(tx, ownerId, targetColumn[0], targetColumn[1]),
        ]);
      if (changes.deleted || !enabled || status !== "pending") {
        await tx.runAsync(
          `INSERT INTO calendar_scheduled_notifications
            (reminder_id, scheduling_status, updated_at) VALUES (?, 'disabled', ?)
           ON CONFLICT(reminder_id) DO UPDATE SET operating_system_id = NULL,
             scheduled_for = NULL, scheduling_status = 'disabled', last_error = NULL, updated_at = excluded.updated_at`,
          id, now,
        );
      }
      const saved = await tx.getFirstAsync<ReminderRow>(
        `SELECT calendar_reminders.*, COALESCE(calendar_scheduled_notifications.scheduling_status, 'pending') AS scheduling_status,
           calendar_scheduled_notifications.last_error
         FROM calendar_reminders LEFT JOIN calendar_scheduled_notifications
           ON calendar_scheduled_notifications.reminder_id = calendar_reminders.id
         WHERE calendar_reminders.owner_id = ? AND calendar_reminders.id = ?`,
        ownerId, id,
      );
      if (!saved) throw new Error("No se pudo actualizar el recordatorio.");
      return { ...saved, scheduling_status: saved.scheduling_status ?? "pending", last_error: saved.last_error ?? null };
    });
  },

  async setNotificationState(id: string, state: CalendarReminder["scheduling_status"], error: string | null = null) {
    const db = await getPetCareDatabase();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO calendar_scheduled_notifications
        (reminder_id, scheduling_status, last_error, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(reminder_id) DO UPDATE SET scheduling_status = excluded.scheduling_status,
         last_error = excluded.last_error, operating_system_id = NULL, scheduled_for = NULL, updated_at = excluded.updated_at`,
      id, state, error, now,
    );
  },

  async setScheduledNotification(id: string, osId: string, version: number, at: string) {
    const db = await getPetCareDatabase();
    await db.runAsync(
      `INSERT INTO calendar_scheduled_notifications
        (reminder_id, operating_system_id, scheduled_version, scheduled_for, scheduling_status, updated_at)
       VALUES (?, ?, ?, ?, 'scheduled', ?)
       ON CONFLICT(reminder_id) DO UPDATE SET operating_system_id = excluded.operating_system_id,
         scheduled_version = excluded.scheduled_version, scheduled_for = excluded.scheduled_for,
         scheduling_status = 'scheduled', last_error = NULL, updated_at = excluded.updated_at`,
      id, osId, version, at, new Date().toISOString(),
    );
  },

  async getNotificationId(id: string) {
    const db = await getPetCareDatabase();
    const row = await db.getFirstAsync<{ operating_system_id: string | null }>(
      "SELECT operating_system_id FROM calendar_scheduled_notifications WHERE reminder_id = ?",
      id,
    );
    return row?.operating_system_id ?? null;
  },

  async dashboard(): Promise<{ items: CalendarItem[]; reminders: CalendarReminder[] }> {
    const today = new Date();
    const startDay = localDay(new Date(today.getTime() - 7 * 86400000).toISOString());
    const end = new Date(today.getTime() + 14 * 86400000);
    const items = await this.listItems(startDay, localDay(end.toISOString()), {
      petId: null, category: "", status: "", type: "",
    });
    const reminders = (await this.listReminders()).filter(
      (reminder) => reminder.status === "pending" && reminder.enabled === 1,
    );
    return { items, reminders };
  },
};
