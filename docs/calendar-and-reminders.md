# Calendar and reminders — delivery 5

## Local sources and aggregation

The calendar reads existing SQLite domain records instead of copying them into a second events table:

- `care_tasks.next_run_at` supplies the currently pending care occurrence; `care_task_executions` supplies completed, omitted, and cancelled occurrences.
- `appointments.starts_at` supplies veterinary appointments.
- `health_records.next_event_at` supplies future medical dates. The medical record remains the source of truth and is opened in its medical-history screen.
- `calendar_events` contains only user-created personal events; it is not used for care, appointments, or health records.
- `calendar_reminders` is independent of its target event and may contain several reminders for one target.

The original `reminders` table remains unchanged for migration compatibility. Its required pet and mutually exclusive care-task/appointment foreign keys cannot represent general calendar events or medical-record targets. New calendar reminder workflows use `calendar_reminders`; both records remain distinct reminders, not duplicate event data.

Month, week, and day views query a date window and expose filters for pet, category, event source, and status. Appointment and medical events link to their owning domain screen. Care occurrences link to the care activity detail. User events and reminders have calendar-specific detail and edit routes.

## SQLite migrations 0004 and 0005

`0004_calendar_reminders.ts` adds:

- `calendar_events`: UUID, optional pet, title, description, category, start/end, IANA timezone, status, observations, version, timestamps, and soft-delete timestamp. The pet foreign key is owner-scoped; `NULL` means a general event.
- `calendar_reminders`: UUID, one target (`calendar_event`, `care_task`, `appointment`, or `health_record`), reminder timestamp, optional lead minutes, timezone, status, enabled flag, version, timestamps, and soft deletion. Composite foreign keys preserve owner/pet consistency for pet-owned targets. An event can have multiple reminder rows.
- `calendar_scheduled_notifications`: device-only operating-system notification identifier, scheduled version/time, status, and last error. It is not syncable domain data.
- New outbox entity types `calendar_event` and `calendar_reminder`. The migration rebuilds the constrained local outbox and conflict tables, copies all existing rows and dependencies, then restores their indexes.

Event and reminder writes, tombstones, and outbox operations are committed in one SQLite transaction. A reminder operation depends on the latest queued target operation and the pet operation when applicable. Domain `version` remains the known server version (zero for not-yet-synced rows), matching the existing offline write convention; each mutation advances `updated_at` and uses an operation UUID.

`0005_calendar_reminder_pet_integrity.ts` adds insert/update triggers requiring the reminder's pet to exactly match its target's pet, including general events with no pet. This closes the nullable-composite-foreign-key gap without rewriting migration 0004.

## Notifications and Expo Go

The project uses `expo-notifications` `~58.1.8`, the version recommended by the Expo SDK 58 documentation. Local scheduled notifications are supported in Expo Go on Android and iOS; remote push notifications are not supported in Expo Go on Android from SDK 53 and require a Development Build. The app does not register for push tokens or add a native plugin/configuration requirement.

The user action that saves or re-enables a reminder requests notification permission. If permission is denied, the SQLite reminder is still saved and visible with a `denied` scheduling state. Web retains and displays reminders in SQLite but reports local operating-system notifications as unsupported. Past reminder times are retained but are not scheduled.

To avoid duplicates after an interrupted scheduling attempt, a reminder UUID is used as the deterministic notification identifier. Updates first cancel the old scheduled notification and schedule the current reminder again; deletion, attendance, disabling, and source deletion cancel it. A native scheduling error is recorded as `failed` without rolling back the persisted reminder. The user can retry from the reminder detail screen.

## Dashboard

The Dashboard reads its upcoming event items and active pending reminder count from the calendar repository. It includes overdue care tasks, future care tasks, appointments, scheduled medical events, user events, execution history, and reminders without manufacturing demo events. The older decorative pet cards in the introductory Dashboard remain separately labeled as demonstration content.

## PostgreSQL and future API work (not implemented)

The PostgreSQL initial schema already defines `appointments` and a legacy `reminders` table. Before remote sync is enabled, add a new numbered PostgreSQL migration (do not edit migrations 0001/0002) for:

1. `calendar_events`, with UUID primary key, nullable `pet_id`, owner-aware composite foreign key, event fields/status, positive server `version`, timestamps, tombstone, and owner/date indexes.
2. `calendar_reminders`, with UUID primary key, optional pet, exactly one owner-scoped target foreign key to a calendar event, care task, appointment, or health record; `remind_at`, optional `lead_minutes`, timezone, pending/attended/cancelled status, enabled flag, version/timestamps/tombstone, and due/target indexes.
3. `sync_changes.entity_type` acceptance for `calendar_event` and `calendar_reminder`, plus sync validation and snapshot serialization for both types. The local-only scheduled notification table and OS identifiers must never sync.
4. API service validation that a reminder target and its optional pet share the authenticated owner, idempotent create/update/delete operations with the existing operation receipt protocol, and pull responses including tombstones. Add focused migration, owner-isolation, idempotency, and cursor tests before enabling the client.

The calendar client in this delivery does not connect to Neon and does not send sync requests. Existing appointments have no server API implementation in the current repository either; they remain local until that API is separately delivered.

## Validation boundary

SQLite migration/schema, FK, multi-reminder, outbox dependency, recurring-date, and Web UI behavior are exercised by the shared verification route and browser workflow. Expo exports for Android/iOS only prove bundling. Native notification permission prompts, actual OS delivery, reboot/restart rescheduling behavior, and permission-denial UX still require physical Android and iOS Expo Go devices. This implementation persists scheduled notification IDs locally; it does not yet reconcile operating-system schedules after reinstall or device restore.
