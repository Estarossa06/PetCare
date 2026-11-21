import { isValidTimezone, localDateTimeToIso } from "../care/recurrence";
import { calendarRepository } from "./calendarRepository";
import { syncCalendarNotification } from "./calendarNotifications";
import type { CalendarEventInput, CalendarReminderInput } from "./types";

export const calendarService = {
  saveEvent(
    input: Omit<CalendarEventInput, "startsAt" | "endsAt"> & { startsLocal: string; endsLocal: string },
    id?: string,
  ) {
    if (!isValidTimezone(input.timezone)) throw new Error("La zona horaria no es válida.");
    const startsAt = localDateTimeToIso(input.startsLocal, input.timezone);
    const endsAt = input.endsLocal ? localDateTimeToIso(input.endsLocal, input.timezone) : null;
    if (endsAt && endsAt <= startsAt) throw new Error("La fecha de fin debe ser posterior al inicio.");
    const wasUpdate = Boolean(id);
    return calendarRepository.saveEvent({
      petId: input.petId,
      title: input.title,
      description: input.description,
      category: input.category,
      startsAt,
      endsAt,
      timezone: input.timezone,
      status: input.status,
      observations: input.observations,
    }, id).then(async (saved) => {
      if (wasUpdate) await refreshTarget({ kind: "calendar_event", id: saved.id });
      return saved;
    });
  },

  saveAppointment(
    input: { petId: string; title: string; startsLocal: string; endsLocal: string; location: string; notes: string; status: "scheduled" | "completed" | "cancelled" },
    id?: string,
  ) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    if (!isValidTimezone(timezone)) throw new Error("La zona horaria del dispositivo no es válida.");
    const startsAt = localDateTimeToIso(input.startsLocal, timezone);
    const endsAt = input.endsLocal ? localDateTimeToIso(input.endsLocal, timezone) : null;
    if (endsAt && endsAt <= startsAt) throw new Error("La fecha de fin debe ser posterior al inicio.");
    const wasUpdate = Boolean(id);
    return calendarRepository.saveAppointment({
      petId: input.petId,
      title: input.title,
      startsAt,
      endsAt,
      location: input.location,
      notes: input.notes,
      status: input.status,
    }, id).then(async (saved) => {
      if (wasUpdate) await refreshTarget({ kind: "appointment", id: saved.id });
      return saved;
    });
  },

  async saveReminder(
    input: Omit<CalendarReminderInput, "remindAt"> & { remindLocal: string },
    id?: string,
  ) {
    if (!isValidTimezone(input.timezone)) throw new Error("La zona horaria no es válida.");
    if (input.leadMinutes !== null && (!Number.isInteger(input.leadMinutes) || input.leadMinutes < 0)) {
      throw new Error("La anticipación debe ser cero o un número entero positivo.");
    }
    const scheduledAt = input.leadMinutes === null
      ? localDateTimeToIso(input.remindLocal, input.timezone)
      : await calculateLeadTime(input.target, input.leadMinutes, input.timezone);
    if (!scheduledAt) throw new Error("No se pudo calcular la hora del recordatorio.");
    return calendarRepository.saveReminder({
      target: input.target,
      title: input.title,
      remindAt: scheduledAt,
      leadMinutes: input.leadMinutes,
      timezone: input.timezone,
      notes: input.notes,
    }, id);
  },
  refreshTarget,
};

export async function refreshTarget(target: CalendarReminderInput["target"]): Promise<void> {
  const reminders = await calendarRepository.refreshRelativeReminders(target);
  await Promise.all(reminders.map((reminder) => syncCalendarNotification(reminder, false)));
}

async function calculateLeadTime(
  target: CalendarReminderInput["target"],
  leadMinutes: number,
  timezone: string,
): Promise<string> {
  const info = await calendarRepository.targetInfo(target.kind, target.id);
  if (!info.startsAt) throw new Error("Este registro no tiene una fecha programada para calcular la anticipación.");
  const start = target.kind === "health_record"
    ? localDateTimeToIso(`${info.startsAt.slice(0, 10)}T09:00`, timezone)
    : new Date(info.startsAt).toISOString();
  return new Date(new Date(start).getTime() - leadMinutes * 60_000).toISOString();
}
