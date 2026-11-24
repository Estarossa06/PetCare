import * as Crypto from "expo-crypto";
import { getPetCareDatabase } from "../../db/database";
import { getLocalAccountId, withLocalWriteTransaction } from "../../db/localAccount";
import type { Pet, PetFilters, PetInput } from "./types";
import { enqueueMediaDelete, enqueueMediaUpload } from "../sync/mediaQueue";

const entityType = "pet";
const fieldMappings = [
  ["name", "name"],
  ["species", "species"],
  ["breed", "breed"],
  ["sex", "sex"],
  ["birth_date", "birthDate"],
  ["approximate_age_months", "approximateAgeMonths"],
  ["weight_kg", "weightKg"],
  ["color", "color"],
  ["notes", "notes"],
  ["photo_storage_key", "photoStorageKey"],
] as const;
const syncFieldMappings = fieldMappings.filter(([field]) => field !== "photo_storage_key");
const mutableFields = syncFieldMappings.map(([field]) => field);

function toPayload(pet: Pet): string {
  return JSON.stringify({
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed,
    sex: pet.sex,
    birth_date: pet.birth_date,
    approximate_age_months: pet.approximate_age_months,
    weight_kg: pet.weight_kg,
    color: pet.color,
    notes: pet.notes,
    created_at: pet.created_at,
    updated_at: pet.updated_at,
    deleted_at: pet.deleted_at,
  });
}

async function queueOperation(
  tx: Awaited<ReturnType<typeof getPetCareDatabase>>,
  pet: Pet,
  action: "create" | "update" | "delete",
  changedFields: readonly string[],
): Promise<void> {
  const operationId = Crypto.randomUUID().toLowerCase();
  const latest = await tx.getFirstAsync<{ operation_id: string; action: string; base_version: number }>(
    `SELECT operation_id, action, base_version FROM sync_queue
     WHERE account_id = ? AND entity_type = ? AND entity_id = ?
     ORDER BY rowid DESC LIMIT 1`,
    pet.owner_id,
    entityType,
    pet.id,
  );
  const timestamp = new Date().toISOString();
  const baseVersion = latest
    ? latest.action === "create" ? 1 : latest.base_version + 1
    : pet.server_version;
  await tx.runAsync(
    `INSERT INTO sync_queue
      (operation_id, account_id, entity_type, entity_id, action, payload,
       base_version, local_revision, changed_fields, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    operationId,
    pet.owner_id,
    entityType,
    pet.id,
    action,
    toPayload(pet),
    baseVersion,
    pet.local_revision,
    JSON.stringify(changedFields),
    timestamp,
    timestamp,
  );

  if (latest) {
    await tx.runAsync(
      `INSERT INTO sync_queue_dependencies
        (account_id, operation_id, depends_on_operation_id)
       VALUES (?, ?, ?)`,
      pet.owner_id,
      operationId,
      latest.operation_id,
    );
  }
  await tx.runAsync(
    "UPDATE sync_metadata SET updated_at = ? WHERE account_id = ?",
    timestamp,
    pet.owner_id,
  );
}

function normalizeInput(input: PetInput) {
  return {
    name: input.name.trim(),
    species: input.species.trim(),
    breed: input.breed?.trim() || null,
    sex: input.sex,
    birth_date: input.birthDate,
    approximate_age_months: input.approximateAgeMonths,
    weight_kg: input.weightKg,
    color: input.color?.trim() || null,
    notes: input.notes?.trim() || null,
    photo_storage_key: input.photoStorageKey,
  };
}

export const petRepository = {
  async list(filters: PetFilters = {}): Promise<Pet[]> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    const search = filters.search?.trim() ?? "";
    const species = filters.species?.trim() ?? "";
    return db.getAllAsync<Pet>(
      `SELECT * FROM pets
       WHERE owner_id = ? AND deleted_at IS NULL
         AND (? = '' OR name LIKE ? ESCAPE '!' OR breed LIKE ? ESCAPE '!' OR species LIKE ? ESCAPE '!')
         AND (? = '' OR species = ?)
       ORDER BY name COLLATE NOCASE ASC`,
      ownerId,
      search,
      `%${search.replace(/[!%_]/g, "!$&")}%`,
      `%${search.replace(/[!%_]/g, "!$&")}%`,
      `%${search.replace(/[!%_]/g, "!$&")}%`,
      species,
      species,
    );
  },

  async getById(id: string): Promise<Pet | null> {
    const db = await getPetCareDatabase();
    const ownerId = await getLocalAccountId();
    return db.getFirstAsync<Pet>(
      "SELECT * FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
      ownerId,
      id,
    );
  },

  async save(input: PetInput, id?: string, photo?: { assetId: string; mimeType: string; size: number; sha256: string }): Promise<Pet> {
    const fields = normalizeInput(input);
    if (!fields.name) throw new Error("Escribe el nombre de tu mascota.");
    if (!fields.species) throw new Error("Selecciona o indica la especie.");

    return withLocalWriteTransaction(async (tx, ownerId) => {
      const timestamp = new Date().toISOString();
      if (!id) {
        const petId = Crypto.randomUUID().toLowerCase();
        await tx.runAsync(
          `INSERT INTO pets
            (id, owner_id, name, species, breed, sex, birth_date, approximate_age_months,
             weight_kg, color, notes, photo_storage_key, version, local_revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
          petId,
          ownerId,
          fields.name,
          fields.species,
          fields.breed,
          fields.sex,
          fields.birth_date,
          fields.approximate_age_months,
          fields.weight_kg,
          fields.color,
          fields.notes,
          fields.photo_storage_key,
          timestamp,
          timestamp,
        );
        const created = await tx.getFirstAsync<Pet>(
          "SELECT * FROM pets WHERE owner_id = ? AND id = ?",
          ownerId,
          petId,
        );
        if (!created) throw new Error("No se pudo leer el perfil guardado.");
        await queueOperation(tx, created, "create", mutableFields);
        if (photo && fields.photo_storage_key) {
          await tx.runAsync("UPDATE pets SET photo_remote_asset_id = ? WHERE owner_id = ? AND id = ?", photo.assetId, ownerId, petId);
          await enqueueMediaUpload(tx, { accountId: ownerId, assetId: photo.assetId, resourceType: "pet_photo", resourceId: petId, petId, localStorageKey: fields.photo_storage_key, filename: fields.photo_storage_key.split("/").at(-1) ?? "photo.jpg", mimeType: photo.mimeType, size: photo.size, sha256: photo.sha256 });
          const updated = await tx.getFirstAsync<Pet>("SELECT * FROM pets WHERE owner_id = ? AND id = ?", ownerId, petId);
          if (!updated) throw new Error("No se pudo actualizar la foto de la mascota.");
          return updated;
        }
        return created;
      }

      const existing = await tx.getFirstAsync<Pet>(
        "SELECT * FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId,
        id,
      );
      if (!existing) throw new Error("No encontramos esta mascota o ya fue eliminada.");
      if (existing.photo_storage_key !== fields.photo_storage_key && existing.photo_remote_asset_id) {
        await enqueueMediaDelete(tx, { accountId: ownerId, assetId: existing.photo_remote_asset_id, resourceType: "pet_photo", resourceId: id, petId: id, filename: existing.photo_storage_key?.split("/").at(-1) ?? "photo.jpg", mimeType: "image/jpeg" });
      }
      const locallyChangedFields = fieldMappings
        .filter(([field]) => existing[field] !== fields[field])
        .map(([field]) => field);
      if (locallyChangedFields.length === 0) {
        return existing;
      }
      const changedFields = syncFieldMappings
        .filter(([field]) => existing[field] !== fields[field])
        .map(([field]) => field);

      await tx.runAsync(
        `UPDATE pets SET name = ?, species = ?, breed = ?, sex = ?, birth_date = ?,
          approximate_age_months = ?, weight_kg = ?, color = ?, notes = ?,
          photo_storage_key = ?, photo_remote_asset_id = ?, local_revision = local_revision + ?, updated_at = ?
         WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`,
        fields.name,
        fields.species,
        fields.breed,
        fields.sex,
        fields.birth_date,
        fields.approximate_age_months,
        fields.weight_kg,
        fields.color,
        fields.notes,
        fields.photo_storage_key,
        photo ? photo.assetId : fields.photo_storage_key === existing.photo_storage_key ? existing.photo_remote_asset_id : null,
        changedFields.length > 0 ? 1 : 0,
        timestamp,
        ownerId,
        id,
      );
      const saved = await tx.getFirstAsync<Pet>(
        "SELECT * FROM pets WHERE owner_id = ? AND id = ?",
        ownerId,
        id,
      );
      if (!saved) throw new Error("No se pudo leer el perfil actualizado.");
      if (changedFields.length > 0) await queueOperation(tx, saved, "update", changedFields);
      if (photo && fields.photo_storage_key) await enqueueMediaUpload(tx, { accountId: ownerId, assetId: photo.assetId, resourceType: "pet_photo", resourceId: id, petId: id, localStorageKey: fields.photo_storage_key, filename: fields.photo_storage_key.split("/").at(-1) ?? "photo.jpg", mimeType: photo.mimeType, size: photo.size, sha256: photo.sha256 });
      return saved;
    });
  },

  async softDelete(id: string): Promise<Pet> {
    return withLocalWriteTransaction(async (tx, ownerId) => {
      const existing = await tx.getFirstAsync<Pet>(
        "SELECT * FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId,
        id,
      );
      if (!existing) throw new Error("No encontramos esta mascota o ya fue eliminada.");
      await tx.runAsync("DELETE FROM media_upload_queue WHERE account_id=? AND resource_type='pet_photo' AND pet_id=?", ownerId, id);
      const timestamp = new Date().toISOString();
      await tx.runAsync(
        "UPDATE pets SET deleted_at = ?, local_revision = local_revision + 1, updated_at = ? WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        timestamp,
        timestamp,
        ownerId,
        id,
      );
      const deleted = await tx.getFirstAsync<Pet>(
        "SELECT * FROM pets WHERE owner_id = ? AND id = ?",
        ownerId,
        id,
      );
      if (!deleted) throw new Error("No se pudo confirmar la eliminación.");
      await queueOperation(tx, deleted, "delete", ["deleted_at"]);
      return deleted;
    });
  },

};
