import initial from "./0001_initial.ts";
import healthRecords from "./0002_health_records.ts";
import careRoutines from "./0003_care_routines.ts";
import calendarReminders from "./0004_calendar_reminders.ts";
import calendarReminderPetIntegrity from "./0005_calendar_reminder_pet_integrity.ts";
import authenticatedLocalAccounts from "./0006_authenticated_local_accounts.ts";
import petSyncState from "./0007_pet_sync_state.ts";
import domainSyncState from "./0008_domain_sync_state.ts";
import kiraiConversations from "./0009_kirai_conversations.ts";
import mediaStorage from "./0010_media_storage.ts";
import scopedRemoteMediaCache from "./0011_scoped_media_cache.ts";
import type { SqliteMigration } from "./types.ts";

export const migrations: SqliteMigration[] = [initial, healthRecords, careRoutines, calendarReminders, calendarReminderPetIntegrity, authenticatedLocalAccounts, petSyncState, domainSyncState, kiraiConversations, mediaStorage, scopedRemoteMediaCache];
