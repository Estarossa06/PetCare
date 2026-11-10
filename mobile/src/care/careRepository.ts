import * as Crypto from "expo-crypto";
import { getLocalAccountId, withLocalWriteTransaction } from "../db/localAccount";
import { getPetCareDatabase } from "../db/database";
import { refreshTarget } from "../calendar/calendarService";
import { isoToLocalDateTime, localDateTimeToIso, nextOccurrence } from "./recurrence";
import type {
  CareCategory,
  CareExecution,
  CareSchedule,
  CareTask,
  CareTaskInput,
  ExecutionStatus,
} from "./types";

type CareTaskRow = Omit<CareTask, "category" | "schedule"> & {
  task_type: string;
  category: string;
  recurrence_rule: string | null;
  schedule_json: string;
};

type ExecutionRow = CareExecution;

function toTask(row: CareTaskRow): CareTask {
  return {
    ...row,
    category: row.category as CareCategory,
    schedule: JSON.parse(row.schedule_json) as CareSchedule,
  };
}

function taskPayload(task: CareTask): string {
  return JSON.stringify({
    id: task.id,
    owner_id: task.owner_id,
    pet_id: task.pet_id,
    task_type: task.category === "exercise" || task.category === "custom" ? "custom" : task.category,
    category: task.category,
    title: task.title,
    description: task.description,
    observations: task.observations,
    notes: task.notes,
    recurrence_rule: JSON.stringify(task.schedule),
    schedule: task.schedule,
    timezone: task.timezone,
    starts_at: task.starts_at,
    next_run_at: task.next_run_at,
    ends_at: task.ends_at,
    enabled: task.enabled,
    version: task.version,
    created_at: task.created_at,
    updated_at: task.updated_at,
    deleted_at: task.deleted_at,
  });
}

function executionPayload(execution: CareExecution): string {
  return JSON.stringify(execution);
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
  entityType: "care_task" | "care_execution",
  entityId: string,
  action: "create" | "update" | "delete",
  payload: string,
  baseVersion: number,
  changedFields: string[],
  dependencies: string[],
): Promise<string> {
  const operationId = Crypto.randomUUID().toLowerCase();
  const timestamp = new Date().toISOString();
  await tx.runAsync(
    `INSERT INTO sync_queue
      (operation_id, account_id, entity_type, entity_id, action, payload,
       base_version, changed_fields, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    operationId,
    ownerId,
    entityType,
    entityId,
    action,
    payload,
    baseVersion,
    JSON.stringify(changedFields),
    timestamp,
    timestamp,
  );
  for (const dependency of new Set(dependencies)) {
    if (dependency === operationId) continue;
    await tx.runAsync(
      `INSERT OR IGNORE INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
      ownerId,
      operationId,
      dependency,
    );
  }
  await tx.runAsync(
    "UPDATE sync_metadata SET updated_at = ? WHERE account_id = ?",
    timestamp,
    ownerId,
  );
  return operationId;
}

async function getPet(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  petId: string,
): Promise<boolean> {
  const pet = await tx.getFirstAsync<{ id: string }>(
    "SELECT id FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
    ownerId,
    petId,
  );
  return Boolean(pet);
}

function taskDependencies(
  petOperation: string | null,
  previousTaskOperation: string | null,
): string[] {
  return [petOperation, previousTaskOperation].filter((value): value is string => Boolean(value));
}

async function readTask(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  id: string,
): Promise<CareTask | null> {
  const row = await tx.getFirstAsync<CareTaskRow>(
    "SELECT * FROM care_tasks WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
    ownerId,
    id,
  );
  return row ? toTask(row) : null;
}

function toDatabaseTaskType(category: CareCategory) {
  return ["feeding", "walk", "bath", "hygiene", "medication", "vaccination", "deworming"].includes(category)
    ? category
    : "custom";
}

function initialNextRun(input: CareTaskInput): string | null {
  if (!input.enabled) return null;
  return input.startsAt;
}

async function nextUnrecordedRun(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  taskId: string,
  input: CareTaskInput,
): Promise<string | null> {
  let candidate = initialNextRun(input);
  for (let attempt = 0; candidate && attempt < 10000; attempt++) {
    const recorded = await tx.getFirstAsync<{ id: string }>(
      `SELECT id FROM care_task_executions
       WHERE owner_id = ? AND task_id = ? AND scheduled_for = ? AND deleted_at IS NULL
       LIMIT 1`,
      ownerId,
      taskId,
      candidate,
    );
    if (!recorded) return candidate;
    candidate = nextOccurrence(candidate, input.schedule, input.timezone, input.endsAt, candidate, input.startsAt);
  }
  if (candidate) throw new Error("La actividad contiene demasiadas ejecuciones anteriores para reprogramarse.");
  return null;
}

function isoDateForZone(value: string, timezone: string): string {
  return isoToLocalDateTime(value, timezone).slice(0, 10);
}

export const careRepository = {
  async list(
    petId: string,
    filters: { search?: string; category?: CareCategory | ""; enabled?: "all" | "enabled" | "disabled" } = {},
  ): Promise<CareTask[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    if (!(await getPet(db, ownerId, petId))) throw new Error("No encontramos esta mascota en la cuenta local.");
    const search = filters.search?.trim() ?? "";
    const category = filters.category ?? "";
    const enabled = filters.enabled ?? "all";
    const rows = await db.getAllAsync<CareTaskRow>(
      `SELECT * FROM care_tasks
       WHERE owner_id = ? AND pet_id = ? AND deleted_at IS NULL
         AND (? = '' OR title LIKE ? ESCAPE '!')
         AND (? = '' OR category = ?)
         AND (? = 'all' OR (? = 'enabled' AND enabled = 1) OR (? = 'disabled' AND enabled = 0))
       ORDER BY enabled DESC, next_run_at IS NULL, next_run_at ASC, title COLLATE NOCASE`,
      ownerId,
      petId,
      search,
      `%${search.replace(/[!%_]/g, "!$&")}%`,
      category,
      category,
      enabled,
      enabled,
      enabled,
    );
    return rows.map(toTask);
  },

  async getById(id: string): Promise<{ task: CareTask; executions: CareExecution[] } | null> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const task = await readTask(db, ownerId, id);
    if (!task) return null;
    const executions = await db.getAllAsync<ExecutionRow>(
      `SELECT * FROM care_task_executions
       WHERE owner_id = ? AND task_id = ? AND deleted_at IS NULL
       ORDER BY scheduled_for DESC, created_at DESC`,
      ownerId,
      id,
    );
    return { task, executions };
  },

  async upcoming(petId: string, limit = 12): Promise<(CareTask & { pet_name: string })[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const rows = await db.getAllAsync<CareTaskRow & { pet_name: string }>(
      `SELECT care_tasks.*, pets.name AS pet_name
       FROM care_tasks JOIN pets
         ON pets.owner_id = care_tasks.owner_id AND pets.id = care_tasks.pet_id
       WHERE care_tasks.owner_id = ? AND care_tasks.deleted_at IS NULL
         AND care_tasks.enabled = 1 AND care_tasks.next_run_at IS NOT NULL
         AND (? = '' OR care_tasks.pet_id = ?)
       ORDER BY care_tasks.next_run_at ASC LIMIT ?`,
      ownerId,
      petId ?? "",
      petId ?? "",
      limit,
    );
    return rows.map((row) => ({ ...toTask(row), pet_name: row.pet_name }));
  },

  async history(petId: string): Promise<(CareExecution & { task_title: string; category: CareCategory; timezone: string })[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    return db.getAllAsync<CareExecution & { task_title: string; category: CareCategory; timezone: string }>(
      `SELECT care_task_executions.*, care_tasks.title AS task_title, care_tasks.category, care_tasks.timezone
       FROM care_task_executions JOIN care_tasks
         ON care_tasks.owner_id = care_task_executions.owner_id
        AND care_tasks.id = care_task_executions.task_id
       WHERE care_task_executions.owner_id = ? AND care_task_executions.pet_id = ?
         AND care_task_executions.deleted_at IS NULL
       ORDER BY COALESCE(care_task_executions.executed_at, care_task_executions.scheduled_for) DESC`,
      ownerId,
      petId,
    );
  },

  async dashboard(): Promise<{
    today: (CareTask & { pet_name: string })[];
    upcoming: (CareTask & { pet_name: string })[];
    overdue: (CareTask & { pet_name: string })[];
    completedToday: number;
  }> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const now = new Date();
    const nowIso = now.toISOString();
    const rows = await db.getAllAsync<CareTaskRow & { pet_name: string }>(
      `SELECT care_tasks.*, pets.name AS pet_name
       FROM care_tasks JOIN pets
         ON pets.owner_id = care_tasks.owner_id AND pets.id = care_tasks.pet_id
       WHERE care_tasks.owner_id = ? AND care_tasks.deleted_at IS NULL
         AND pets.deleted_at IS NULL AND care_tasks.enabled = 1
       ORDER BY care_tasks.next_run_at ASC`,
      ownerId,
    );
    const tasks = rows.map((row) => ({ ...toTask(row), pet_name: row.pet_name }));
    const today: typeof tasks = [];
    const upcoming: typeof tasks = [];
    const overdue: typeof tasks = [];
    for (const task of tasks) {
      if (!task.next_run_at) continue;
      const taskDay = isoDateForZone(task.next_run_at, task.timezone);
      const todayDay = isoDateForZone(nowIso, task.timezone);
      if (taskDay === todayDay) today.push(task);
      if (task.next_run_at < nowIso) overdue.push(task);
      else if (task.next_run_at > nowIso && task.next_run_at <= new Date(now.getTime() + 7 * 86400000).toISOString()) upcoming.push(task);
    }

    const executionRows = await db.getAllAsync<{ executed_at: string; timezone: string }>(
      `SELECT care_task_executions.executed_at, care_tasks.timezone
       FROM care_task_executions JOIN care_tasks
         ON care_tasks.owner_id = care_task_executions.owner_id
        AND care_tasks.id = care_task_executions.task_id
       WHERE care_task_executions.owner_id = ? AND care_task_executions.status = 'completed'
         AND care_task_executions.deleted_at IS NULL AND care_task_executions.executed_at IS NOT NULL`,
      ownerId,
    );
    const completedToday = executionRows.filter(
      (execution) => isoDateForZone(execution.executed_at, execution.timezone) === isoDateForZone(nowIso, execution.timezone),
    ).length;
    return { today, upcoming, overdue, completedToday };
  },

  async save(petId: string, input: CareTaskInput, id?: string): Promise<CareTask> {
    if (!input.title.trim()) throw new Error("El nombre de la actividad es obligatorio.");
    if (!Number.isInteger(input.schedule.interval) || input.schedule.interval < 1 || input.schedule.interval > 365) {
      throw new Error("El intervalo debe ser un número entero entre 1 y 365.");
    }
    const shouldRefreshReminders = Boolean(id);
    const savedTask = await withLocalWriteTransaction(async (tx, ownerId) => {
      if (!(await getPet(tx, ownerId, petId))) throw new Error("La mascota no existe o no pertenece a esta cuenta.");
      const timestamp = new Date().toISOString();
      const scheduleJson = JSON.stringify(input.schedule);
      const nextRunAt = initialNextRun(input);
      const databaseType = toDatabaseTaskType(input.category);
      let action: "create" | "update";
      if (id) {
        const existing = await readTask(tx, ownerId, id);
        if (!existing || existing.pet_id !== petId) throw new Error("No encontramos esta actividad para la mascota.");
        const priorCompletion = await tx.getFirstAsync<{ id: string }>(
          `SELECT id FROM care_task_executions
           WHERE owner_id = ? AND task_id = ? AND status = 'completed' AND deleted_at IS NULL
           LIMIT 1`,
          ownerId,
          id,
        );
        const canScheduleOnceAgain = input.schedule.frequency !== "once" || !priorCompletion;
        const scheduleUnchanged = existing.schedule.frequency === input.schedule.frequency
          && existing.schedule.interval === input.schedule.interval
          && existing.schedule.unit === input.schedule.unit
          && existing.starts_at === input.startsAt
          && existing.timezone === input.timezone
          && existing.ends_at === input.endsAt;
        const nextRunAt = input.enabled && canScheduleOnceAgain
          ? (scheduleUnchanged && existing.next_run_at
            ? existing.next_run_at
            : await nextUnrecordedRun(tx, ownerId, id, input))
          : null;
        const taskEnabled = input.enabled && canScheduleOnceAgain && Boolean(nextRunAt);
        await tx.runAsync(
          `UPDATE care_tasks SET task_type = ?, category = ?, title = ?, notes = ?,
            description = ?, observations = ?, recurrence_rule = ?, schedule_json = ?,
            timezone = ?, starts_at = ?, next_run_at = ?, ends_at = ?, enabled = ?, updated_at = ?
           WHERE owner_id = ? AND pet_id = ? AND id = ? AND deleted_at IS NULL`,
          databaseType,
          input.category,
          input.title.trim(),
          input.observations.trim() || null,
          input.description.trim() || null,
          input.observations.trim() || null,
          scheduleJson,
          scheduleJson,
          input.timezone,
          input.startsAt,
          canScheduleOnceAgain ? nextRunAt : null,
          input.endsAt,
          taskEnabled ? 1 : 0,
          timestamp,
          ownerId,
          petId,
          id,
        );
        action = "update";
      } else {
        id = Crypto.randomUUID().toLowerCase();
        await tx.runAsync(
          `INSERT INTO care_tasks
            (id, owner_id, pet_id, task_type, category, title, notes, description,
             observations, recurrence_rule, schedule_json, timezone, starts_at,
             next_run_at, ends_at, enabled, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          ownerId,
          petId,
          databaseType,
          input.category,
          input.title.trim(),
          input.observations.trim() || null,
          input.description.trim() || null,
          input.observations.trim() || null,
          scheduleJson,
          scheduleJson,
          input.timezone,
          input.startsAt,
          nextRunAt,
          input.endsAt,
          input.enabled ? 1 : 0,
          timestamp,
          timestamp,
        );
        action = "create";
      }

      const task = await readTask(tx, ownerId, id);
      if (!task) throw new Error("No se pudo leer la actividad guardada.");
      const previous = await latestOperation(tx, ownerId, "care_task", task.id);
      const petOperation = await latestOperation(tx, ownerId, "pet", petId);
      await queueOperation(
        tx,
        ownerId,
        "care_task",
        task.id,
        action,
        taskPayload(task),
        task.version,
        ["category", "title", "description", "observations", "schedule", "starts_at", "next_run_at", "ends_at", "enabled", "timezone"],
        taskDependencies(petOperation, previous),
      );
      return task;
    });
    if (shouldRefreshReminders) await refreshTarget({ kind: "care_task", id: savedTask.id });
    return savedTask;
  },

  async setEnabled(id: string, enabled: boolean): Promise<CareTask> {
    return withLocalWriteTransaction(async (tx, ownerId) => {
      const task = await readTask(tx, ownerId, id);
      if (!task) throw new Error("No encontramos esta actividad.");
      let nextRunAt = task.next_run_at;
      if (enabled && !nextRunAt) {
        const completed = await tx.getFirstAsync<{ id: string }>(
          `SELECT id FROM care_task_executions
           WHERE owner_id = ? AND task_id = ? AND status = 'completed' AND deleted_at IS NULL
           LIMIT 1`,
          ownerId,
          id,
        );
        if (task.schedule.frequency === "once" && completed) {
          throw new Error("Una actividad de una sola vez que ya se completó no se puede volver a activar.");
        }
        nextRunAt = await nextUnrecordedRun(tx, ownerId, id, {
          category: task.category,
          title: task.title,
          description: task.description ?? "",
          observations: task.observations ?? "",
          schedule: task.schedule,
          startsAt: task.starts_at,
          endsAt: task.ends_at,
          timezone: task.timezone,
          enabled: true,
        });
        if (!nextRunAt) throw new Error("Esta actividad ya no tiene una ejecución pendiente. Crea una nueva programación.");
      }
      const timestamp = new Date().toISOString();
      await tx.runAsync(
        "UPDATE care_tasks SET enabled = ?, next_run_at = ?, updated_at = ? WHERE owner_id = ? AND id = ?",
        enabled && nextRunAt ? 1 : 0,
        enabled ? nextRunAt : task.next_run_at,
        timestamp,
        ownerId,
        id,
      );
      const taskEnabled = Boolean(enabled && nextRunAt);
      const updated = { ...task, enabled: taskEnabled ? 1 : 0, next_run_at: enabled ? nextRunAt : task.next_run_at, updated_at: timestamp };
      const previous = await latestOperation(tx, ownerId, "care_task", id);
      const petOperation = await latestOperation(tx, ownerId, "pet", task.pet_id);
      await queueOperation(tx, ownerId, "care_task", id, "update", taskPayload(updated), task.version, ["enabled", "next_run_at"], taskDependencies(petOperation, previous));
      return updated;
    });
  },

  async softDelete(id: string): Promise<CareTask> {
    const deletedTask = await withLocalWriteTransaction(async (tx, ownerId) => {
      const task = await readTask(tx, ownerId, id);
      if (!task) throw new Error("No encontramos esta actividad o ya fue eliminada.");
      const timestamp = new Date().toISOString();
      await tx.runAsync(
        "UPDATE care_tasks SET deleted_at = ?, enabled = 0, updated_at = ? WHERE owner_id = ? AND id = ?",
        timestamp,
        timestamp,
        ownerId,
        id,
      );
      const deleted = { ...task, deleted_at: timestamp, enabled: 0, updated_at: timestamp };
      const previous = await latestOperation(tx, ownerId, "care_task", id);
      const petOperation = await latestOperation(tx, ownerId, "pet", task.pet_id);
      await queueOperation(tx, ownerId, "care_task", id, "delete", taskPayload(deleted), task.version, ["deleted_at", "enabled"], taskDependencies(petOperation, previous));
      return deleted;
    });
    await refreshTarget({ kind: "care_task", id });
    return deletedTask;
  },

  async recordExecution(id: string, status: ExecutionStatus, notes = ""): Promise<CareExecution> {
    const execution = await withLocalWriteTransaction(async (tx, ownerId) => {
      const task = await readTask(tx, ownerId, id);
      if (!task || !task.enabled || !task.next_run_at) throw new Error("Esta actividad no tiene una ejecución pendiente.");
      const scheduledFor = task.next_run_at;
      const timestamp = new Date().toISOString();
      const executionId = Crypto.randomUUID().toLowerCase();
      const nextRunAt = nextOccurrence(
        scheduledFor,
        task.schedule,
        task.timezone,
        task.ends_at,
        timestamp,
        task.starts_at,
      );
      await tx.runAsync(
        `INSERT INTO care_task_executions
          (id, owner_id, task_id, pet_id, scheduled_for, executed_at, status, notes,
           version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        executionId,
        ownerId,
        task.id,
        task.pet_id,
        scheduledFor,
        status === "completed" ? timestamp : null,
        status,
        notes.trim() || null,
        timestamp,
        timestamp,
      );
      await tx.runAsync(
        "UPDATE care_tasks SET next_run_at = ?, enabled = ?, updated_at = ? WHERE owner_id = ? AND id = ?",
        nextRunAt,
        nextRunAt ? 1 : 0,
        timestamp,
        ownerId,
        task.id,
      );
      const updatedTask = { ...task, next_run_at: nextRunAt, enabled: nextRunAt ? 1 : 0, updated_at: timestamp };
      const previousTask = await latestOperation(tx, ownerId, "care_task", task.id);
      const petOperation = await latestOperation(tx, ownerId, "pet", task.pet_id);
      const taskOperation = await queueOperation(
        tx,
        ownerId,
        "care_task",
        task.id,
        "update",
        taskPayload(updatedTask),
        task.version,
        ["next_run_at", "enabled"],
        taskDependencies(petOperation, previousTask),
      );
      const execution: CareExecution = {
        id: executionId,
        owner_id: ownerId,
        task_id: task.id,
        pet_id: task.pet_id,
        scheduled_for: scheduledFor,
        executed_at: status === "completed" ? timestamp : null,
        status,
        notes: notes.trim() || null,
        version: 0,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      };
      await queueOperation(
        tx,
        ownerId,
        "care_execution",
        executionId,
        "create",
        executionPayload(execution),
        execution.version,
        ["task_id", "pet_id", "scheduled_for", "executed_at", "status", "notes"],
        [taskOperation],
      );
      return execution;
    });
    await refreshTarget({ kind: "care_task", id });
    return execution;
  },
};

export function displayTaskTime(task: CareTask, value = task.next_run_at ?? task.starts_at): string {
  return isoToLocalDateTime(value, task.timezone).replace("T", " ");
}
