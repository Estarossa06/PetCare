# Mobile data and synchronization boundaries

This records the current code paths. Automated repository tests do not prove
behavior on physical Android or iOS devices; use the two-installation pilot in
[`../testing/offline-first-two-installations.md`](../testing/offline-first-two-installations.md).

| Area | Local source of truth | Remote path and current boundary |
| --- | --- | --- |
| Registration, login, refresh, logout | SecureStore on native; session storage on Web | Auth API backed by PostgreSQL. Login restores the local account partition by authenticated user ID. |
| Pets | Per-account SQLite repositories | `petSync` pushes/pulls through `/sync/v1`, consumes ACKs, versions, cursors, tombstones, retries, and conflicts. |
| Medical records, care tasks/executions, appointments, events, reminders | Per-account SQLite repositories and `sync_queue` outbox | `domainSync` sends the six domain entity types through `/sync/v1/domain/*`; server derives ownership from JWT. |
| Pet photos and medical attachments | Per-account SQLite metadata and local file storage | `mediaSync` uploads/downloads only through the authenticated API. The API validates content and transfers objects to private-configured R2; mobile has no R2 credentials. Remote bucket privacy must still be confirmed in Cloudflare. |
| Dashboard | Local repositories | Reads current local data; may show unsynchronized local changes. |
| KIRAI | Local account-specific screen/cache as configured | Authenticated API, PostgreSQL conversation persistence, and configured Ollama provider. Context is owner-scoped server-side. |
| Notifications | Per-device SQLite scheduling state and OS scheduler | Device-local only. They are not synchronized as remote notification requests. |

## Offline queue and recovery

Repositories commit entity changes, queue operations, dependency edges, and
local revisions in SQLite transactions. Push selects due work in dependency
order. A dependency must either be in the same earlier position of the selected
batch or already have been acknowledged and removed from the dependency table;
an unresolved cross-entity or failed dependency is held back. ACK results remove
only the matching account's operation. A missing/incomplete result is retried,
not treated as success. Retries use bounded exponential delay and stable
operation IDs for idempotent server replay.

Pull pages apply entity changes and their cursor in one SQLite transaction.
Changes that collide with local queued work create a conflict record. The
conflict UI can keep local or apply remote data; dependent operations are
rewired/blocked accordingly. Tombstones carry deletions through pull. On database
open, interrupted `in_flight` pet/domain/media rows return to retryable state.
The mobile login/logout flow waits for active sync, and synchronization verifies
the active authenticated account before applying server responses. Outbox
updates and retry statements are account-scoped.

Media downloads use storage keys containing both the local account partition
and remote asset ID. This matters because remote asset IDs are scoped by owner
and can legally repeat for two different owners. Uploaded objects remain
available locally for offline use. A failed local file write does not advance
the remote media cursor, so the page can be retried.

Migration 0011 adds a per-account cache-key version. On the first media sync
after upgrading, that account's media cursor resets once so existing remote
assets are pulled again and stored under account-scoped keys; the old local copy
remains available until reconnection completes the refresh. Device tests should
exercise this upgrade while online and offline.

Session restoration on cold start calls the API to validate/rotate the saved
refresh token. If the API is unreachable, protected routes remain closed even
though the SQLite partition still exists. Offline work after a process restart
is therefore unavailable until the account can restore its session; make this
explicit during physical testing.

## PostgreSQL migration and schema checks

The API runner recognizes exactly the `remote` and `legacy-local` histories,
checks the version-5 name and SHA-256 checksum, then validates each applied
version/name/checksum and the contiguous prefix before application DDL. New
databases select `remote`; migration status performs no project DDL/DML but
acquires a PostgreSQL advisory session lock. `pet_tracking` is
version 5 in `remote`, version 12 in `legacy-local`; account deletion is version
13 in both. See [`postgres-migration-lineages.md`](postgres-migration-lineages.md).

SQLite migration application is transactional per migration and validates
version/name continuity before applying more application DDL. Its ledger does
not store content checksums, so edits to an already applied SQLite migration
cannot be detected from the local ledger alone. Keep applied migration files
immutable and add new numbered migrations for schema changes.

## Local account isolation

Authenticated data maps each server user ID to a stable random SQLite
`account_id` in `sync_metadata.auth_user_id`. Repositories filter by that
partition; switching accounts does not import or reassign another partition.
Anonymous legacy data remains unassigned unless a separate, explicit import
flow is implemented. Local file cache keys for downloaded remote assets are
also account-partitioned.

## Verification boundary

PostgreSQL integration suites use disposable, UUID-tagged fixtures and target
only `petcare_test`. They verify owner isolation, replay/idempotency, versions,
conflicts, pull cursors, tombstones, and the six domain entities. Mobile tests
use SQLite in-process to verify migration, outbox recovery, ordering, retry
scoping, conflict resolution, and account partitions. Neither suite is a
physical two-device test; use the reproducible pilot checklist before claiming
device-level offline recovery.
