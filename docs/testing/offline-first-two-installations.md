# Offline-first pilot: two installations

Use this procedure only with test accounts and an API whose PostgreSQL target is
the disposable `petcare_test` database. Do not point a pilot build at production.
Use two Android/iOS installations (physical devices or emulators); the current
automated tests do not replace this device-level validation.

## Prepare the pair

1. Install the same PetCare test build on installations A and B. Connect both to
   the test API and sign in with the same test account.
2. On A, create a pet with a photo, one medical record with a small test PDF,
   one care task and execution, an appointment, a calendar event, and a reminder.
3. Wait for the sync status screen to show no pending or failed operations. On B,
   refresh and verify the records, relationships, photo, and PDF are present.
4. Keep a second test account available for the isolation pass; do not reuse
   personal or production data.

## Offline and recovery pass

1. On A, enable airplane mode. Edit the pet and medical record; create another
   care task and execution, appointment, event, and reminder. Delete one test
   event. Confirm the UI shows local changes and that the sync status lists the
   expected pending work without claiming it was sent.
2. Force-stop A while it is offline, reopen it, and verify the records and
   pending work remain. Repeat after a device reboot if the pilot supports it.
3. While A remains offline, edit the same pet on B and wait for B to sync.
   Restore A's connection. Confirm its queued operation is not lost or
   acknowledged early, and that the resulting version conflict appears in the
   sync status screen.
4. Resolve the conflict once with the local version and once in a fresh test
   run with the remote version. Confirm the selected snapshot wins, dependent
   operations remain ordered, and retrying does not create duplicates.
5. On A, sync the event tombstone. Confirm B receives the deletion and does not
   resurrect the event on a later pull. Verify reminder notifications remain
   device-local and are reconciled on each installation.
6. Repeat an offline create/edit/delete followed by force-stop and reconnect.
   Confirm push, pull, ACK, and cursors advance only after local application.

## Media pass

1. While connected, upload a test photo and PDF; verify the server returns their
   remote identifiers and the UI still has local copies.
2. On B, download both and compare the displayed/opened files. Confirm their
   local storage keys differ between account partitions and that SHA-256
   verification succeeds.
3. Queue a replacement photo and a document upload while A is offline; force-stop
   A, reconnect, and confirm the upload queue retries without duplicate assets.
4. Delete a test attachment, sync its tombstone, and confirm B removes its local
   copy after receiving the tombstone. Repeat with network loss during upload or
   download and confirm retry after reconnect.

## Account isolation pass

1. On B, sign out of the shared test account and sign in with the second test
   account. Confirm none of the first account's records or media appear; do not
   import anonymous or previous-account data.
2. Create and sync a pet under the second account. Sign back into the first
   account and verify its original records remain while the second account's
   pet and media stay hidden.
3. Check both accounts through their normal authenticated app views. Never use
   a production account or manually edit database rows during the pilot.

## Evidence to record

Record app/build version, device and OS, test account labels (not passwords),
operation IDs, before/after sync status, conflict choice, cursor values shown by
diagnostic tooling, and any request IDs from sanitized API logs. Do not record
tokens, connection strings, personal files, or real customer data. A successful
pilot requires the checks above on actual installations; API and SQLite unit
tests alone are not evidence of physical-device behavior.
