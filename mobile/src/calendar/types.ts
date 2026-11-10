export type CalendarSource =
  | "care_task"
  | "care_execution"
  | "appointment"
  | "health_record"
  | "calendar_event"
  | "calendar_reminder";

export type CalendarItem = {
  id: string;
  source: CalendarSource;
  sourceId: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  day: string;
  timezone: string;
  petId: string | null;
  petName: string | null;
  allDay: boolean;
  targetId: string;
};

export type CalendarEventCategory = "custom" | "birthday" | "travel" | "grooming" | "other";
export type CalendarEventStatus = "scheduled" | "completed" | "cancelled";

export type CalendarEvent = {
  id: string;
  owner_id: string;
  pet_id: string | null;
  title: string;
  description: string | null;
  category: CalendarEventCategory;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  status: CalendarEventStatus;
  observations: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CalendarEventInput = {
  petId: string | null;
  title: string;
  description: string;
  category: CalendarEventCategory;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  status: CalendarEventStatus;
  observations: string;
};

export type CalendarReminderStatus = "pending" | "attended" | "cancelled";
export type CalendarReminderTarget =
  | { kind: "calendar_event"; id: string }
  | { kind: "care_task"; id: string }
  | { kind: "appointment"; id: string }
  | { kind: "health_record"; id: string };

export type CalendarReminder = {
  id: string;
  owner_id: string;
  pet_id: string | null;
  calendar_event_id: string | null;
  care_task_id: string | null;
  appointment_id: string | null;
  health_record_id: string | null;
  title: string;
  remind_at: string;
  lead_minutes: number | null;
  timezone: string;
  status: CalendarReminderStatus;
  enabled: number;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  scheduling_status: "pending" | "scheduled" | "denied" | "unsupported" | "expired" | "failed" | "disabled";
  last_error: string | null;
};

export type CalendarReminderInput = {
  target: CalendarReminderTarget;
  title: string;
  remindAt: string;
  leadMinutes: number | null;
  timezone: string;
  notes: string;
};

export type CalendarPetOption = { id: string; name: string };
export type CalendarFilters = {
  petId: string | null;
  category: string;
  status: string;
  type: string;
};
