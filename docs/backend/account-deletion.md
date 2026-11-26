# Account deactivation and permanent deletion

## Distinct operations

- **Deactivation** sets `users.deleted_at` and revokes all sessions. It retains
  account data so the operation is not represented as permanent erasure.
- **Permanent deletion request** verifies the current password, marks the user
  inactive, revokes all sessions and refresh tokens, and creates a durable
  request. The API responds `202 pending_permanent_deletion`; this is not a
  completion receipt.

## Worker and recovery

Migration 0013 (`account_deletion_worker`) adds an opaque request ID, attempt
counter, retry time, processing lease, and a safe error code. The API worker
claims due requests using `FOR UPDATE SKIP LOCKED`, so multiple API instances
do not claim the same request. A lease allows a later process to reclaim work
after a crash. Failures use bounded exponential backoff; logs contain the
request ID and an enumerated error code, not SQL text, object keys, or secrets.

For each request the worker:

1. Lists the exact `media/<owner UUID>/` R2 prefix and removes every object,
   including unreferenced objects. It also checks database object keys are in
   that same owner prefix. If R2 or LIST/DELETE is unavailable, the request
   remains retryable and no account rows are removed.
2. In a PostgreSQL transaction, removes media metadata/cleanup rows, medical
   and calendar children, routine executions, KIRAI and legacy AI history,
   sync feed/receipts/cursors/devices, refresh-token history/sessions, domain
   records, tracker associations, pets, and finally the user row.
3. Retains only a completed operational receipt with a random request ID and
   no `user_id`. That preserves operational traceability without retaining
   the account identifier in the request ledger.

The R2 delete operation is idempotent. If the process stops after deleting
some objects, the next pass lists and deletes the remaining prefix. If the DB
transaction fails, PostgreSQL rolls back all relational deletions and the
request is rescheduled. A FK or unexpected dependent table therefore blocks
completion rather than silently leaving a partial account purge.

## Device-local data and limits

After the server accepts a permanent deletion request, the initiating app
instance stops sync, removes that account's local photo/document files and
SQLite rows, then clears its local session. If local file deletion fails, the
app reports that local cleanup was incomplete and keeps the account rows for
recovery rather than claiming they were erased. An offline second device
cannot be remotely wiped; its user must remove PetCare's app data before
handing the device to another person. Server completion does not imply that
every offline device has erased its local copy.

## Operational and policy requirements

- Configure R2 with LIST and DELETE permissions for the worker. Without R2
  configuration the worker deliberately keeps deletion requests pending,
  because it cannot prove that objects and orphans are absent.
- Monitor `account_deletion_deferred` and `account_deletion_worker_failed`;
  investigate repeated safe error codes and re-run the worker after fixing the
  dependency. Do not manually mark a request completed.
- The completed request receipt contains a random ID and timestamps. Product
  and legal owners must decide its retention period, audit access, and whether
  any other records must be retained for legal or safety reasons. No retention
  period is encoded by this implementation.
- Local records on devices not currently online cannot be included in a
  server-side completion guarantee. Communicate this limitation before
  enabling self-service deletion in production.

Migration 0013 is appended to both supported PostgreSQL histories; prior
migration files and checksums remain unchanged. See
[PostgreSQL migration lineages](postgres-migration-lineages.md).
