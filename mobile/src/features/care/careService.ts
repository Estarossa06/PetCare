import { isValidTimezone, localDateTimeToIso } from "./recurrence";
import { careRepository } from "./careRepository";
import type { CareTaskInput } from "./types";

export const careService = {
  ...careRepository,

  save(petId: string, input: Omit<CareTaskInput, "startsAt" | "endsAt"> & { startsLocal: string; endsLocal: string }, id?: string) {
    if (!input.title.trim()) throw new Error("El nombre de la actividad es obligatorio.");
    if (!isValidTimezone(input.timezone)) throw new Error("La zona horaria no es válida.");
    const startsAt = localDateTimeToIso(input.startsLocal, input.timezone);
    const endsAt = input.endsLocal ? localDateTimeToIso(`${input.endsLocal}T23:59`, input.timezone) : null;
    if (endsAt && endsAt <= startsAt) throw new Error("La fecha de finalización debe ser posterior al inicio.");
    if (input.schedule.frequency === "custom" && (!Number.isInteger(input.schedule.interval) || input.schedule.interval < 1)) {
      throw new Error("Indica un intervalo personalizado válido.");
    }
    return careRepository.save(petId, {
      category: input.category,
      title: input.title,
      description: input.description,
      observations: input.observations,
      schedule: input.schedule,
      startsAt,
      endsAt,
      timezone: input.timezone,
      enabled: input.enabled,
    }, id);
  },
};

export const careCategoryLabels = {
  feeding: "Alimentación",
  walk: "Paseo",
  bath: "Baño",
  hygiene: "Higiene",
  medication: "Medicamento",
  vaccination: "Vacunación",
  deworming: "Desparasitación",
  exercise: "Ejercicio",
  custom: "Personalizado",
} as const;

export const frequencyLabels = {
  once: "Una sola vez",
  daily: "Diariamente",
  weekly: "Semanalmente",
  monthly: "Mensualmente",
  custom: "Personalizada",
} as const;
