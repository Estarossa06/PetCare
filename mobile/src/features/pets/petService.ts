import * as Crypto from "expo-crypto";
import { petPhotoStorage } from "./petPhotoStorage";
import { petRepository } from "./petRepository";
import type { PetFilters, PetInput } from "./types";
import { synchronizePets } from "../sync/petSync";
import { sha256Hex } from "../sync/mediaQueue";

function triggerSync(): void {
  void synchronizePets().catch(() => undefined);
}

function getPhotoExtension(mimeType?: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    default:
      return "jpg";
  }
}

function validateProfile(input: PetInput): void {
  if (!input.name.trim()) {
    throw new Error("El nombre es obligatorio.");
  }
  if (!input.species.trim()) {
    throw new Error("Indica la especie de tu mascota.");
  }
  if (input.birthDate && input.approximateAgeMonths !== null) {
    throw new Error("Indica la fecha de nacimiento o la edad aproximada, no ambas.");
  }
  if (input.birthDate) {
    const date = new Date(`${input.birthDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.birthDate) {
      throw new Error("La fecha de nacimiento no es válida.");
    }
    if (date.getTime() > Date.now()) {
      throw new Error("La fecha de nacimiento no puede estar en el futuro.");
    }
  }
  if (input.approximateAgeMonths !== null && (!Number.isInteger(input.approximateAgeMonths) || input.approximateAgeMonths < 0)) {
    throw new Error("La edad aproximada debe ser un número entero de meses.");
  }
  if (input.weightKg !== null && (!Number.isFinite(input.weightKg) || input.weightKg <= 0)) {
    throw new Error("El peso debe ser un número mayor que cero.");
  }
}

async function photoMetadata(key: string, mimeType?: string) {
  const blob = await petPhotoStorage.readPhoto(key);
  if (blob.size < 1 || blob.size > 10 * 1024 * 1024) throw new Error("La foto debe pesar entre 1 byte y 10 MB.");
  return { assetId: Crypto.randomUUID().toLowerCase(), mimeType: mimeType ?? (key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg"), size: blob.size, sha256: await sha256Hex(await blob.arrayBuffer()) };
}

export const petService = {
  list(filters?: PetFilters) {
    return petRepository.list(filters);
  },

  getById(id: string) {
    return petRepository.getById(id);
  },

  async create(input: PetInput, selectedPhoto?: { uri: string; mimeType?: string }) {
    validateProfile(input);
    const key = selectedPhoto
      ? `pet-photos/${Crypto.randomUUID().toLowerCase()}.${getPhotoExtension(selectedPhoto.mimeType)}`
      : null;
    if (selectedPhoto && key) {
      await petPhotoStorage.savePickedPhoto(selectedPhoto.uri, key);
    }
    try {
      const saved = await petRepository.save({ ...input, photoStorageKey: key }, undefined, key ? await photoMetadata(key, selectedPhoto?.mimeType) : undefined);
      triggerSync();
      return saved;
    } catch (error) {
      if (key) await petPhotoStorage.deletePhoto(key);
      throw error;
    }
  },

  async update(
    id: string,
    input: PetInput,
    selectedPhoto?: { uri: string; mimeType?: string },
  ) {
    validateProfile(input);
    const key = selectedPhoto
      ? `pet-photos/${Crypto.randomUUID().toLowerCase()}.${getPhotoExtension(selectedPhoto.mimeType)}`
      : input.photoStorageKey;
    if (selectedPhoto && key) {
      await petPhotoStorage.savePickedPhoto(selectedPhoto.uri, key);
    }
    try {
      const changedPhoto = Boolean(selectedPhoto);
      const saved = await petRepository.save({ ...input, photoStorageKey: key }, id, changedPhoto && key ? await photoMetadata(key, selectedPhoto?.mimeType) : undefined);
      triggerSync();
      return saved;
    } catch (error) {
      if (selectedPhoto && key) await petPhotoStorage.deletePhoto(key);
      throw error;
    }
  },

  async delete(id: string) {
    const deleted = await petRepository.softDelete(id);
    triggerSync();
    return deleted;
  },
};

export { petPhotoStorage };
