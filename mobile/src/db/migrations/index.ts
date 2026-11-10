import initial from "./0001_initial";
import healthRecords from "./0002_health_records";
import careRoutines from "./0003_care_routines";
import calendarReminders from "./0004_calendar_reminders";
import calendarReminderPetIntegrity from "./0005_calendar_reminder_pet_integrity";
import type { SqliteMigration } from "./types";

export const migrations: SqliteMigration[] = [initial, healthRecords, careRoutines, calendarReminders, calendarReminderPetIntegrity];
