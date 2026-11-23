import type { CalendarReminderTarget } from "../types";

type ReminderTargetState = {
  enabled?: number;
  status?: string;
} | null;

export function isTerminalReminderTarget(
  kind: CalendarReminderTarget["kind"],
  state: ReminderTargetState,
): boolean {
  if (!state) return true;
  if (kind === "care_task") return state.enabled === 0;
  if (kind === "calendar_event" || kind === "appointment") {
    return state.status === "completed" || state.status === "cancelled";
  }
  return false;
}
