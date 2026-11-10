import * as Crypto from "expo-crypto";
import { medicalFileStorage } from "./medicalFileStorage";
import { medicalRepository } from "./medicalRepository";
import type {
  MedicalCategory,
  MedicalRecordInput,
  PickedMedicalFile,
  PreparedMedicalFile,
} from "./types";

function validDate(value: string, label: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!value || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} debe tener formato AAAA-MM-DD.`);
  }
}

function nextDate(details: MedicalRecordInput["details"]): string | undefined {
  return details.nextDoseDate ?? details.nextApplicationDate;
}

function validate(input: MedicalRecordInput): void {
  if (!input.title.trim()) throw new Error("El título es obligatorio.");
  validDate(input.occurredAt, "La fecha del acontecimiento");
  const next = nextDate(input.details);
  if (next) validDate(next, "La próxima fecha");
  if (input.category === "vaccination" && input.details.applicationDate) {
    validDate(input.details.applicationDate, "La fecha de aplicación");
  }
}

export const medicalService = {
  ...medicalRepository,

  async save(
    petId: string,
    input: MedicalRecordInput,
    id?: string,
    selectedFiles: PickedMedicalFile[] = [],
  ) {
    validate(input);
    const prepared: PreparedMedicalFile[] = [];
    try {
      for (const file of selectedFiles) {
        const attachmentId = Crypto.randomUUID().toLowerCase();
        const storageKey = `medical-files/${attachmentId}`;
        const item: PreparedMedicalFile = { ...file, id: attachmentId, storageKey };
        prepared.push(item);
        await medicalFileStorage.save(file.uri, storageKey);
        const uri = await medicalFileStorage.getUri(storageKey);
        if (!uri) throw new Error(`No se pudo verificar el archivo ${file.name}.`);
        item.uri = uri;
      }
      return await medicalRepository.save(petId, input, id, prepared);
    } catch (error) {
      const cleanupErrors: string[] = [];
      for (const file of prepared) {
        try {
          await medicalFileStorage.delete(file.storageKey);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
        }
      }
      if (cleanupErrors.length) {
        throw new Error(
          `No se guardó el registro y algunos archivos temporales no pudieron limpiarse: ${cleanupErrors.join("; ")}`,
          { cause: error },
        );
      }
      throw error;
    }
  },
};

export const medicalCategoryLabels: Record<MedicalCategory, string> = {
  consultation: "Consulta veterinaria",
  vaccination: "Vacunación",
  deworming: "Desparasitación",
  medication: "Medicamento",
  treatment: "Tratamiento",
  surgery: "Cirugía",
  allergy: "Alergia",
  diagnosis: "Diagnóstico profesional",
  examination: "Examen y resultados",
  observation: "Observación médica",
};
