# Mobile data and service boundaries

This describes the behavior wired in the current repository. A table or screen
does not imply that its data is remotely synchronized.

| Area | Current operation path | Persistence / boundary |
| --- | --- | --- |
| Account registration, login, refresh, logout | Mobile `apiClient` → `/auth/*` | API uses PostgreSQL through `PostgresAuthStore`; mobile stores native tokens in SecureStore and browser tokens in `sessionStorage`. |
| Pet profile CRUD | Mobile `petRepository` | SQLite only. The API has owner-scoped pet endpoints, but this repository does not call them. |
| Pet photos | `petPhotoStorage` | Device file storage (web uses browser storage); no photo upload for normal profile save. |
| Visual identification | `apiClient` → `/pet-identification/analyze` | Authenticated API request; image is decoded/normalized by the API and passed to configured local Ollama. It is not a pet CRUD operation. |
| Medical history and attachments | `medicalRepository`, `medicalFileStorage` | SQLite plus device/browser file storage. No API CRUD or binary transfer is wired from the mobile module. |
| Care routines and execution history | `careRepository` | SQLite only. No remote execution entity/API contract. |
| Appointments, calendar events and reminders | `calendarRepository` | SQLite only. Notification scheduling is separately reconciled with the operating system on supported native platforms; it is not server synchronization. |
| Dashboard | Dashboard services/repositories | Reads local pets, care, medical and calendar repositories. |
| KIRAI | Mobile API wrapper → `/kirai/availability`, `/kirai/chat` | Authenticated API/Ollama call. Recent conversation turns stay in screen memory and are sent with each request; pet profile data is not attached. |
| Sync queue | Local repositories insert rows in `sync_queue` | No mobile worker, API push/pull endpoints, ACK protocol, or conflict resolution currently consumes these rows. Do not present these writes as queued-to-sync work. |

## Ownership and account switching

Authenticated data uses a stable, separate local `account_id` mapping for each
server user ID, stored in SQLite `sync_metadata.auth_user_id` (migration 0006).
Every current domain query and write derives `owner_id` from that local account
and scopes entity access by owner. The pre-existing anonymous mapping remains
unassigned; login does not import or reassign its data. There is no UI or
automatic migration that merges local account spaces.

## Remote integration boundary

The API has PostgreSQL migrations and owner-scoped pet endpoints, but this is
not end-to-end synchronization: mobile pet CRUD remains local, and medical,
care-execution, calendar-event, calendar-reminder, and attachment contracts
are missing or differ from the local schema. The local outbox also supports
entity kinds that PostgreSQL's current change-feed constraint does not accept.
Before synchronization is implemented, reconcile deployed migration state in
a disposable database, define compatible entity DTOs and attachment storage,
then implement owner-scoped transactions, idempotent operation receipts, pull
cursors, tombstones, and conflict behavior. Keep the app offline-first until
that contract and test environment exist.
