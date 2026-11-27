import { getPetCareDatabase } from "../../db/database";
import { getActiveLocalAuthUserId, getLocalAccountId } from "../../db/localAccount";

type LocalContextKind = "pets" | "healthRecords" | "careTasks" | "careExecutions" | "appointments" | "calendarEvents" | "calendarReminders";
export type LocalPetContext = Partial<Record<LocalContextKind, Record<string, unknown>[]>> & {
  deleted?: Partial<Record<LocalContextKind, string[]>>;
};

function contextRecord(row: Record<string, unknown>): Record<string, unknown> {
  const result = { ...row };
  if (typeof result.schedule_json === "string") {
    try { result.schedule = JSON.parse(result.schedule_json); } catch { result.schedule = null; }
    delete result.schedule_json;
  }
  if (typeof result.enabled === "number") result.enabled = result.enabled === 1;
  return result;
}

export async function readPendingPetContext(authUserId: string): Promise<LocalPetContext> {
  if (getActiveLocalAuthUserId() !== authUserId) return {};
  const accountId = await getLocalAccountId();
  const database = await getPetCareDatabase();
  const pending = "owner_id=? AND local_revision>acknowledged_local_revision";
  const [pets, healthRecords, careTasks, careExecutions, appointments, calendarEvents, calendarReminders] = await Promise.all([
    database.getAllAsync<Record<string, unknown>>(`SELECT id,name,species,breed,sex,birth_date,approximate_age_months,weight_kg,color FROM pets WHERE ${pending} AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20`, accountId),
    database.getAllAsync<Record<string, unknown>>(`SELECT id,pet_id,record_type,record_subtype,title,description,occurred_at,clinic_name,observations,next_event_at FROM health_records WHERE ${pending} AND deleted_at IS NULL ORDER BY occurred_at DESC LIMIT 20`, accountId),
    database.getAllAsync<Record<string, unknown>>(`SELECT id,pet_id,task_type,category,title,description,observations,schedule_json,timezone,starts_at,next_run_at,enabled FROM care_tasks WHERE ${pending} AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20`, accountId),
    database.getAllAsync<Record<string, unknown>>(`SELECT execution.id,execution.task_id,execution.pet_id,task.title AS task_title,execution.scheduled_for,execution.executed_at,execution.status,execution.notes FROM care_task_executions execution LEFT JOIN care_tasks task ON task.id=execution.task_id AND task.owner_id=execution.owner_id WHERE execution.owner_id=? AND execution.local_revision>execution.acknowledged_local_revision AND execution.deleted_at IS NULL ORDER BY execution.scheduled_for DESC LIMIT 20`, accountId),
    database.getAllAsync<Record<string, unknown>>(`SELECT id,pet_id,title,starts_at,ends_at,location,notes,status,timezone FROM appointments WHERE ${pending} AND deleted_at IS NULL ORDER BY starts_at DESC LIMIT 20`, accountId),
    database.getAllAsync<Record<string, unknown>>(`SELECT id,pet_id,title,description,category,starts_at,ends_at,timezone,status,observations FROM calendar_events WHERE ${pending} AND deleted_at IS NULL ORDER BY starts_at DESC LIMIT 20`, accountId),
    database.getAllAsync<Record<string, unknown>>(`SELECT id,pet_id,title,remind_at,timezone,status,enabled FROM calendar_reminders WHERE ${pending} AND deleted_at IS NULL ORDER BY remind_at DESC LIMIT 20`, accountId),
  ]);
  if (getActiveLocalAuthUserId() !== authUserId) return {};

  const deleted: Partial<Record<LocalContextKind, string[]>> = {};
  const deletedQueries = await Promise.all([
    ["pets", "pets"], ["healthRecords", "health_records"], ["careTasks", "care_tasks"],
    ["careExecutions", "care_task_executions"], ["appointments", "appointments"],
    ["calendarEvents", "calendar_events"], ["calendarReminders", "calendar_reminders"],
  ].map(async ([kind, table]) => {
    const rows = await database.getAllAsync<{ id: string }>(`SELECT id FROM ${table} WHERE owner_id=? AND deleted_at IS NOT NULL AND local_revision>acknowledged_local_revision ORDER BY updated_at DESC LIMIT 200`, accountId);
    return [kind, rows.map((row) => row.id)] as const;
  }));
  for (const [kind, ids] of deletedQueries) if (ids.length) deleted[kind as LocalContextKind] = ids;

  return {
    pets: pets.map(contextRecord),
    healthRecords: healthRecords.map(contextRecord),
    careTasks: careTasks.map(contextRecord),
    careExecutions: careExecutions.map(contextRecord),
    appointments: appointments.map(contextRecord),
    calendarEvents: calendarEvents.map(contextRecord),
    calendarReminders: calendarReminders.map(contextRecord),
    deleted,
  };
}
