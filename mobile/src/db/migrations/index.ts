import initial from "./0001_initial";
import healthRecords from "./0002_health_records";
import careRoutines from "./0003_care_routines";
import calendarReminders from "./0004_calendar_reminders";
import calendarReminderPetIntegrity from "./0005_calendar_reminder_pet_integrity";
import authenticatedLocalAccounts from "./0006_authenticated_local_accounts";
import petSyncState from "./0007_pet_sync_state";
import domainSyncState from "./0008_domain_sync_state";
import kiraiConversations from "./0009_kirai_conversations";
import mediaStorage from "./0010_media_storage";
import type { SqliteMigration } from "./types";

export const migrations: SqliteMigration[] = [initial, healthRecords, careRoutines, calendarReminders, calendarReminderPetIntegrity, authenticatedLocalAccounts, petSyncState, domainSyncState, kiraiConversations, mediaStorage];
