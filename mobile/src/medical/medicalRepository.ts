import * as Crypto from "expo-crypto";
import { getPetCareDatabase } from "../db/database";
import { getLocalAccountId, withLocalWriteTransaction } from "../db/localAccount";
import { refreshTarget } from "../calendar/calendarService";
import type {
  MedicalAttachment,
  MedicalCategory,
  MedicalDetails,
  MedicalRecord,
  MedicalRecordInput,
  PreparedMedicalFile,
} from "./types";

type MedicalRow = Omit<MedicalRecord, "category" | "details"> & {
  record_type: string;
  record_subtype: string | null;
  details_json: string;
};

const toCategory = (row: MedicalRow): MedicalCategory =>
  row.record_subtype === "exam" ? "examination" : row.record_type as MedicalCategory;

function toRecord(row: MedicalRow): MedicalRecord {
  return {
    ...row,
    category: toCategory(row),
    details: JSON.parse(row.details_json) as MedicalDetails,
  };
}

function recordPayload(record: MedicalRecord): string {
  return JSON.stringify({
    id: record.id,
    owner_id: record.owner_id,
    pet_id: record.pet_id,
    record_type: record.category === "examination" ? "observation" : record.category,
    record_subtype: record.category === "examination" ? "exam" : null,
    title: record.title,
    description: record.description,
    occurred_at: record.occurred_at,
    professional_name: record.professional_name,
    clinic_name: record.clinic_name,
    observations: record.observations,
    details: record.details,
    next_event_at: record.next_event_at,
    version: record.version,
    created_at: record.created_at,
    updated_at: record.updated_at,
    deleted_at: record.deleted_at,
  });
}

async function addDependency(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  operationId: string,
  dependsOnOperationId: string | null,
): Promise<void> {
  if (!dependsOnOperationId || dependsOnOperationId === operationId) return;
  await tx.runAsync(
    `INSERT OR IGNORE INTO sync_queue_dependencies
      (account_id, operation_id, depends_on_operation_id) VALUES (?, ?, ?)`,
    ownerId,
    operationId,
    dependsOnOperationId,
  );
}

async function queueOperation(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  entityType: "health_record" | "health_attachment",
  entityId: string,
  action: "create" | "update" | "delete",
  payload: string,
  baseVersion: number,
  changedFields: string[],
  dependsOn: string[],
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
  for (const dependency of dependsOn) {
    await addDependency(tx, ownerId, operationId, dependency);
  }
  await tx.runAsync("UPDATE sync_metadata SET updated_at = ? WHERE account_id = ?", timestamp, ownerId);
  return operationId;
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

async function petDependency(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  petId: string,
): Promise<string[]> {
  const operation = await latestOperation(tx, ownerId, "pet", petId);
  return operation ? [operation] : [];
}

async function resolveRecord(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  ownerId: string,
  id: string,
): Promise<MedicalRecord | null> {
  const row = await tx.getFirstAsync<MedicalRow>(
    "SELECT * FROM health_records WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
    ownerId,
    id,
  );
  return row ? toRecord(row) : null;
}

export const medicalRepository = {
  async list(petId: string, filters: { search?: string; category?: MedicalCategory | "" } = {}) {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const pet = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
      ownerId,
      petId,
    );
    if (!pet) throw new Error("No encontramos esta mascota en la cuenta local.");
    const search = filters.search?.trim() ?? "";
    const category = filters.category ?? "";
    const rows = await db.getAllAsync<MedicalRow>(
      `SELECT * FROM health_records
       WHERE owner_id = ? AND pet_id = ? AND deleted_at IS NULL
         AND (? = '' OR title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!' OR observations LIKE ? ESCAPE '!')
         AND (? = '' OR record_type = ? OR (? = 'examination' AND record_subtype = 'exam'))
       ORDER BY occurred_at DESC, created_at DESC`,
      ownerId,
      petId,
      search,
      `%${search.replace(/[!%_]/g, "!$&")}%`,
      `%${search.replace(/[!%_]/g, "!$&")}%`,
      `%${search.replace(/[!%_]/g, "!$&")}%`,
      category,
      category === "examination" ? "observation" : category,
      category,
    );
    return rows.map(toRecord);
  },

  async getById(id: string) {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const row = await db.getFirstAsync<MedicalRow>(
      "SELECT * FROM health_records WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
      ownerId,
      id,
    );
    if (!row) return null;
    const attachments = await db.getAllAsync<MedicalAttachment>(
      `SELECT * FROM health_attachments
       WHERE owner_id = ? AND health_record_id = ? AND deleted_at IS NULL
       ORDER BY created_at`,
      ownerId,
      id,
    );
    return { record: toRecord(row), attachments };
  },

  async upcoming(petId: string) {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const rows = await db.getAllAsync<MedicalRow>(
      `SELECT * FROM health_records
       WHERE owner_id = ? AND pet_id = ? AND deleted_at IS NULL
         AND next_event_at >= ?
       ORDER BY next_event_at ASC`,
      ownerId,
      petId,
      new Date().toISOString().slice(0, 10),
    );
    return rows.map(toRecord);
  },

  async save(petId: string, input: MedicalRecordInput, id?: string, files: PreparedMedicalFile[] = []) {
    const shouldRefreshReminders = Boolean(id);
    const savedRecord = await withLocalWriteTransaction(async (tx, ownerId) => {
      const pet = await tx.getFirstAsync<{ id: string }>(
        "SELECT id FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId,
        petId,
      );
      if (!pet) throw new Error("La mascota no existe o no pertenece a esta cuenta.");

      const timestamp = new Date().toISOString();
      let record: MedicalRecord;
      let action: "create" | "update";
      if (id) {
        const existing = await resolveRecord(tx, ownerId, id);
        if (!existing || existing.pet_id !== petId) {
          throw new Error("No encontramos este registro médico para la mascota seleccionada.");
        }
        await tx.runAsync(
          `UPDATE health_records SET record_type = ?, record_subtype = ?, title = ?,
            description = ?, occurred_at = ?, professional_name = ?, clinic_name = ?,
            observations = ?, details_json = ?, next_event_at = ?, updated_at = ?
           WHERE owner_id = ? AND pet_id = ? AND id = ? AND deleted_at IS NULL`,
          input.category === "examination" ? "observation" : input.category,
          input.category === "examination" ? "exam" : null,
          input.title.trim(),
          input.description.trim() || null,
          input.occurredAt,
          input.professionalName.trim() || null,
          input.clinicName.trim() || null,
          input.observations.trim() || null,
          JSON.stringify(input.details),
          nextEventDate(input),
          timestamp,
          ownerId,
          petId,
          id,
        );
        const saved = await resolveRecord(tx, ownerId, id);
        if (!saved) throw new Error("No se pudo leer el registro actualizado.");
        record = { ...saved, updated_at: timestamp };
        action = "update";
      } else {
        const recordId = Crypto.randomUUID().toLowerCase();
        await tx.runAsync(
          `INSERT INTO health_records
            (id, owner_id, pet_id, record_type, record_subtype, title, description,
             occurred_at, professional_name, clinic_name, observations, details_json,
             next_event_at, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          recordId,
          ownerId,
          petId,
          input.category === "examination" ? "observation" : input.category,
          input.category === "examination" ? "exam" : null,
          input.title.trim(),
          input.description.trim() || null,
          input.occurredAt,
          input.professionalName.trim() || null,
          input.clinicName.trim() || null,
          input.observations.trim() || null,
          JSON.stringify(input.details),
          nextEventDate(input),
          timestamp,
          timestamp,
        );
        const saved = await resolveRecord(tx, ownerId, recordId);
        if (!saved) throw new Error("No se pudo leer el registro creado.");
        record = saved;
        action = "create";
      }

      const previousOperation = await latestOperation(tx, ownerId, "health_record", record.id);
      const operationId = await queueOperation(
        tx,
        ownerId,
        "health_record",
        record.id,
        action,
        recordPayload(record),
        record.version,
        Object.keys(input).filter((key) => key !== "details").concat("details"),
        [...await petDependency(tx, ownerId, petId), ...(previousOperation ? [previousOperation] : [])],
      );
      for (const file of files) {
        await tx.runAsync(
          `INSERT INTO health_attachments
            (id, owner_id, pet_id, health_record_id, storage_key, local_uri,
             original_filename, mime_type, size_bytes, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?)`,
          file.id,
          ownerId,
          petId,
          record.id,
          file.storageKey,
          file.name,
          file.mimeType,
          Math.max(file.size, 1),
          timestamp,
          timestamp,
        );
        const attachment = await tx.getFirstAsync<MedicalAttachment>(
          "SELECT * FROM health_attachments WHERE owner_id = ? AND id = ?",
          ownerId,
          file.id,
        );
        if (!attachment) throw new Error("No se pudo registrar el archivo adjunto.");
        await queueOperation(
          tx,
          ownerId,
          "health_attachment",
          file.id,
          "create",
          JSON.stringify(attachment),
          0,
          ["health_record_id", "storage_key", "original_filename", "mime_type", "size_bytes"],
          [operationId],
        );
      }
      return record;
    });
    if (shouldRefreshReminders) await refreshTarget({ kind: "health_record", id: savedRecord.id });
    return savedRecord;
  },

  async softDelete(id: string) {
    const deletedRecord = await withLocalWriteTransaction(async (tx, ownerId) => {
      const record = await resolveRecord(tx, ownerId, id);
      if (!record) throw new Error("No encontramos este registro médico o ya fue eliminado.");
      const timestamp = new Date().toISOString();
      await tx.runAsync(
        "UPDATE health_records SET deleted_at = ?, updated_at = ? WHERE owner_id = ? AND id = ?",
        timestamp,
        timestamp,
        ownerId,
        id,
      );
      const deleted = { ...record, deleted_at: timestamp, updated_at: timestamp };
      const previousOperation = await latestOperation(tx, ownerId, "health_record", id);
      const deleteOperation = await queueOperation(
        tx,
        ownerId,
        "health_record",
        id,
        "delete",
        recordPayload(deleted),
        deleted.version,
        ["deleted_at"],
        [...await petDependency(tx, ownerId, record.pet_id), ...(previousOperation ? [previousOperation] : [])],
      );

      const attachments = await tx.getAllAsync<MedicalAttachment>(
        `SELECT * FROM health_attachments
         WHERE owner_id = ? AND health_record_id = ? AND deleted_at IS NULL`,
        ownerId,
        id,
      );
      for (const attachment of attachments) {
        await tx.runAsync(
          "UPDATE health_attachments SET deleted_at = ?, updated_at = ? WHERE owner_id = ? AND id = ?",
          timestamp,
          timestamp,
          ownerId,
          attachment.id,
        );
        const previousAttachmentOperation = await latestOperation(tx, ownerId, "health_attachment", attachment.id);
        const deletedAttachment = { ...attachment, deleted_at: timestamp, updated_at: timestamp };
        await queueOperation(
          tx,
          ownerId,
          "health_attachment",
          attachment.id,
          "delete",
          JSON.stringify(deletedAttachment),
          deletedAttachment.version,
          ["deleted_at"],
          [deleteOperation, ...(previousAttachmentOperation ? [previousAttachmentOperation] : [])],
        );
      }
      return deleted;
    });
    await refreshTarget({ kind: "health_record", id });
    return deletedRecord;
  },
};

function nextEventDate(input: MedicalRecordInput): string | null {
  const date = input.details.nextDoseDate ?? input.details.nextApplicationDate ?? null;
  return date ? `${date}T00:00:00.000Z` : null;
}
