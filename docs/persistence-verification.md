# Persistence verification report

## Result summary

- PostgreSQL migrations 1–3 were applied successfully to the configured Neon development database, then rerun successfully as already-applied with matching checksums. Final status reports all three applied. The schema/domain verifier and per-owner cursor concurrency verifier passed, including explicit fixture cleanup checks.
- SQLite schema review found and corrected three local integrity gaps before native deployment: UUID values were checked only for length, queue dependencies could refer across accounts, and unsynchronized rows defaulted to server version `1`. UUID checks now enforce canonical lowercase UUID text; queue dependency/conflict foreign keys include the account; new local records start at server version `0`.
- Web runtime validation in the shared Expo app passed in the integrated browser, including real SQLite WASM open/migrate, assertions, CRUD, close/reopen persistence and reload. The same Expo Router project is used for every platform.
- The workspace-provided root `.env` held the local Neon URL; it was not read to output, logged, or tracked. Added `/.env` to `.gitignore` after finding that the root file was not ignored. The API commands loaded it using `DOTENV_CONFIG_PATH=..\.env`.
- Neon/PostgreSQL persistence validation requested here passed. The wider Fase 2 verification is still not fully closed because Android/iOS native SQLite runtime and production-hosted Web SQLite remain outstanding.

## PostgreSQL review notes

1. `schema_migrations` is created before per-migration transactions. Each migration and its ledger row are then committed together. A failed migration rolls back its DDL and ledger entry.
2. The advisory lock serializes migration runners. Repeating `db:migrate` skips a known migration only if its name and checksum match. Both `db:migrate` and `db:migrate:status` refuse database migration versions not present in the local migration set; status also validates checksums.
3. Migration checksums are generated from each migration's `up` function source. Applied migration files must remain immutable; schema changes require a new migration.
4. The runner does not provide down migrations. Back up or use a disposable database before applying schema changes.
5. UUID columns in PostgreSQL enforce UUID syntax natively. Owner-aware composite foreign keys prevent child rows from claiming a different pet owner; they do not replace API authorization.
6. Soft deletion is represented, not automated: callers must set `deleted_at`, update `updated_at`, and increment `version` in the same transaction. The database does not currently enforce this through triggers.
7. Feed cursor ordering uses one `sync_cursors` row per owner, updated transactionally with its `sync_changes` inserts. The row lock serializes allocations through commit; rollbacks undo the counter update. Migration 0003 backfills old identity cursors into dense owner-local cursors, translates saved per-device cursors to the corresponding owner-local position, and then changes the primary key. This guarantees no missed committed feed row only if every future writer reserves a contiguous range in the same transaction as the domain mutation and feed inserts; the sync writer/API is not implemented.

### Cursor strategy alternatives and selected design

1. **Plain PostgreSQL sequence/identity plus a maximum-cursor watermark — rejected.** Sequence numbers are allocated outside the transaction and are not rolled back; a transaction holding a lower number can commit after a higher number. A client that advances to the higher watermark could then skip the late commit.
2. **Transaction-scoped advisory lock per owner — viable but rejected.** Acquiring it before cursor allocation and holding it through commit can serialize commits, but all writers must use exactly the same lock-key derivation and lock protocol; advisory locks are not represented as relational state and future write paths could omit the protocol.
3. **Per-owner transactional counter row — selected.** Updating the owner's row locks it until transaction end. The same transaction reserves a range and inserts its change rows; commit order and cursor order agree for that owner, and rollback reuses the number. It is explicit, database-enforced through transactional row locking, and allows unrelated owners to proceed independently. Its tradeoff is serialization of all change-producing transactions for one owner.
4. **Logical decoding/WAL commit positions — not selected.** Commit-aware positions are robust but require replication/WAL access, slot management, retention and more operational complexity than this app needs.

The future writer must increment `last_cursor` by the number of change rows, insert the reserved contiguous range in that same transaction, and commit only after domain and feed writes succeed. Pull uses `(owner_id, cursor > last_seen)` ordered ascending and the client advances only to the last row actually delivered. All writes for a single owner serialize on one counter row (a per-owner throughput tradeoff); different owners progress independently. `api/src/db/verify-cursor.ts` passed its two-transaction test against Neon. The actual change-feed writer and API are not implemented, so the test validates the counter/locking mechanism, not a future endpoint integration.

## Local SQLite review notes

- UUID columns for entity IDs, queue operation IDs, account IDs, and notification reminder IDs validate the canonical lowercase UUID shape.
- Child records use composite `(owner_id, pet_id)` or `(owner_id, parent_id, pet_id)` foreign keys, so records cannot attach to another owner's pet.
- Queue dependencies and conflict references use `(account_id, operation_id)` composite foreign keys to prevent cross-account links.
- SQLite rows start at `version = 0`, representing a local-only row not yet assigned a server version. Server-confirmed versions are supplied explicitly. `sync_queue.base_version = 0` expresses the same initial base.
- `PRAGMA foreign_keys = ON` is connection-scoped and must be applied on every SQLite connection that performs writes. The migration runner enables it on the connection passed to it.
- The verification route now checks that migrations can be repeated, required domain/sync tables exist, verifier fixtures roll back, CRUD works, soft-deleted data survives closing/reopening the SQLite handle, and test rows are cleaned up.
- A migration defect was found during test preparation: migration 0001 attempted to create `_local_migrations` even though the migration runner creates the ledger before applying migrations. Removed the duplicate ledger DDL; the real browser run then passed.

## Exact local Neon setup and migration commands (PowerShell)

Use a disposable development/test Neon database, not production. Do not paste the connection string into a command, commit it, or include it in logs. The run documented here used a root `.env` file loaded explicitly from the API directory; the file is Git-ignored by `/.env`. For the recommended API-local option, use `api/.env` (also ignored).

```powershell
if (-not (Test-Path api\.env)) { Copy-Item api\.env.example api\.env }
notepad api\.env
```

In the local editor, replace the placeholder `DATABASE_URL` with the Neon connection URL and retain `sslmode=require`. `.env` is ignored by Git. Then run:

```powershell
npm install --prefix api
npm run db:migrate:status --prefix api
npm run db:migrate --prefix api
npm run db:migrate --prefix api
npm run db:migrate:status --prefix api
$env:PETCARE_RUN_DB_CHECKS = "1"
npm run db:verify --prefix api
npm run db:verify:cursor --prefix api
Remove-Item Env:\PETCARE_RUN_DB_CHECKS
```

When using a root `.env` rather than `api/.env`, the executed equivalent is:

```powershell
Set-Location api
$env:DOTENV_CONFIG_PATH = '..\.env'
npm run db:migrate:status
npm run db:migrate
npm run db:migrate
npm run db:migrate:status
$env:PETCARE_RUN_DB_CHECKS = "1"
npm run db:verify
npm run db:verify:cursor
Remove-Item Env:\PETCARE_RUN_DB_CHECKS
Remove-Item Env:\DOTENV_CONFIG_PATH
Pop-Location
```

Expected behavior: the first migration run applies pending versions; the second prints them as already applied and verifies their checksums; status lists all three as applied; the domain verifier checks schema objects, UUID, owner-aware FK isolation, version check, soft deletion, physical delete restriction and unique idempotency operation keys; the cursor verifier checks concurrent per-owner ordering. **These commands passed against the configured Neon development database in this validation.** The domain verifier rolls back its fixture transaction and checks that generated fixture rows are absent; the cursor verifier removes and checks its temporary owner and rows. The unique operation key proves receipt uniqueness only; returning the original stored response for an identical request and rejecting same-key/different-payload at the API layer are not implemented or tested yet. Run these only against a disposable database. Do not print or share `.env` contents.

Check the target before running by using the Neon dashboard or SQL editor to confirm the project/database. The scripts intentionally do not echo the connection string. A missing `DATABASE_URL` or missing explicit `PETCARE_RUN_DB_CHECKS=1` causes the verifier to refuse execution.

### PostgreSQL verifier coverage (executed against Neon)

`api/src/db/verify.ts` checks expected tables, indexes and constraints, and:

- UUID round-trip without changing the client-generated identifier.
- Cross-owner pet/health-record relation rejection.
- Rejection of non-positive server versions.
- Soft deletion retains the row and increments its version when explicitly requested.
- Physical deletion of a parent with dependent health data is rejected.
- Duplicate `(user_id, operation_id)` receipt keys are rejected by the unique constraint.

`api/src/db/verify-cursor.ts` checks that the second transaction cannot allocate its owner's next cursor before the first transaction commits, and that committed events receive cursors `1, 2` without a skipped value.

PostgreSQL owner isolation currently means owner-aware composite foreign keys in the schema. There is no API authorization or row-level-security implementation in this phase; the check does not claim to validate read authorization.

### Neon execution results

- The initial migration status reported versions 1 `core`, 2 `sync_support`, and 3 `ordered_sync_cursors` pending.
- The first `db:migrate` applied all three. The second reported all three already applied; final status reported each as applied with checksums accepted.
- A direct connection using the migration runner's `pg` connection configuration reported `stream.encrypted = true` and `stream.authorized = true`. Neon database-side `pg_stat_ssl` reported `ssl = false`; that server-side view did not reflect the client-to-Neon TLS socket. The client socket's encryption and certificate authorization are the evidence recorded for TLS.
- `db:verify` passed required public tables, expected indexes/constraints, UUID round trip and invalid UUID rejection, cross-owner FK rejection, positive-version constraint, duplicate idempotency key rejection, soft delete/version retention and physical-delete restriction.
- The verifier transaction was rolled back; a follow-up query using its generated fixture UUIDs confirmed no user, pet, health record or idempotency receipt remained.
- `db:verify:cursor` passed the two-transaction lock/wait test and observed committed cursors `1, 2` without a skipped value. Its follow-up cleanup query confirmed no test user, counter or change rows remained.
- The installed `pg-connection-string` emitted a warning that `sslmode=require` currently aliases `verify-full` but may change semantics in a future major version. Current TLS was certificate-authorized. Consider changing local configuration to `sslmode=verify-full` when convenient; credentials were not edited.
- The first verifier attempt exposed a test expectation bug: PostgreSQL returns SQLSTATE `23001` for this `ON DELETE RESTRICT` violation, not `23503`; the assertion was corrected. A cleanup assertion also initially compared `count()`'s `bigint` string result with a JavaScript number; the aggregate is now cast to `int`. Both checks passed after correction. No PostgreSQL migration was modified.
- Duplicate idempotency keys are proven rejected by the database. Replay returning the stored response and rejecting same-key/different-request hashes at the API boundary remain unimplemented and were not claimed as tested.

## SQLite / Expo validation

The single Expo SDK 58 project in `mobile/` uses `app/index.tsx` and the shared `src/screens/DatabaseVerificationScreen.tsx` route for Android, iOS and Web. The temporary verification harness is not a product screen. Its actual Web runtime was exercised in the integrated browser:

1. Expo SQLite opened `petcare-verification.db` through its WebAssembly implementation.
2. The migration runner applied migration 0001 and then ran again successfully.
3. Domain and sync tables were checked; the verifier confirmed canonical UUID constraints, owner-aware pet/health/care foreign keys, version 0 for local rows, soft delete/version increment, care-execution-to-task queue dependencies, queue/conflict account isolation and no FK violations.
4. Insert, select, update, soft delete, close database handle, reopen and read the retained row all passed.
5. The temporary row was removed, and reloading the browser app ran the checks again successfully.
6. Care recurrence checks passed for daily scheduling over the New York spring DST transition, rejection of a nonexistent local time, monthly recurrence anchored at the 31st, and one-time completion.
7. Browser UI testing completed an overdue daily activity and a one-time activity. The history retained both the scheduled time and actual completion time; the daily next run advanced by one local calendar day, while the one-time activity showed no next run. Temporary UI fixtures were logically deleted.

This proves SQLite works in this browser/dev-server configuration, not across all browsers or production hosts. The local Expo dev server response did not include COOP/COEP headers. A production Web deployment still needs secure-origin storage and the configured COOP/COEP headers; test the deployed build and target browsers before treating that deployment as validated.

### Android and iOS Expo Go procedure

| Platform | Expo Go SQLite result | Limitation |
|---|---|---|
| Android | **Not run in Expo Go.** SQLite runtime is not claimed as validated on Android. | No Android phone is connected and no emulator system image is installed. Earlier custom Development Build attempts failed in Reanimated CMake/Ninja on the long Windows path, but that is not required for the current Expo Go workflow. |
| iOS | **Not run in Expo Go.** SQLite runtime is not claimed as validated on iOS. | No iPhone with Expo Go is available for this session. A physical iPhone can use the Windows-hosted Expo Go server; Xcode is only needed for an iOS Simulator or custom native build, not for Expo Go on a physical phone. |
| Web | **Passed in local browser runtime**, including migration repeat, integrity checks, CRUD, close/reopen, reload persistence, and fixture cleanup; this is not native-platform evidence. | The development server did not emit COOP/COEP headers. Production-origin test remains pending. |

No native runtime pass is claimed. To reproduce the shared Android/iOS Expo Go tests, use one of the following from the `mobile/` directory:

```powershell
Set-Location mobile
npm install
npx expo install --check
npm start
```

Scan the QR code using Expo Go on a physical Android or iOS device on the same network. In the shared verification route, run the migration and verifier, repeat migration, execute CRUD/FK/UUID/owner checks, close and reopen SQLite, then fully close and relaunch PetCare and confirm the persisted test marker. `npm run android` / `npm run ios` request opening the same Expo Go project when a suitable device or emulator/simulator is available. If LAN discovery is blocked, start with `npx expo start --go --tunnel`. No SQLCipher option is enabled or selected.

### Web reproducibility command

```powershell
Set-Location mobile
npm run typecheck
npx expo export --platform web
npm run web
```

## Tests run in this environment

- API typecheck/build: passed after extending schema/idempotency checks.
- Expo TypeScript check: passed.
- `npx expo install --check`: passed; SDK dependencies are up to date.
- Expo Doctor: passed 20/20 checks after switching the launch configuration to Expo Go.
- Expo export for Android, iOS and Web: passed after the configuration change. These are bundle checks only.
- Expo Go development server: started with `expo start --go`; Metro `/status` returned HTTP 200. No mobile client connected, so this is not a native SQLite runtime test.
- Actual SQLite Web browser run and browser reload after the configuration change: passed, with steps listed above.
- Expo Go dependency and project configuration checks passed; this does not constitute an Android/iOS SQLite runtime test.
- Expo Go SQLite runtime on Android/iOS: pending; no Android device/emulator or iPhone was available. iOS physical-device Expo Go does not require Xcode, but a device is still needed for the test.
- Neon TLS, migration/repeat/status/schema/domain verifier/cursor verifier/fixture cleanup: passed as detailed above. No `psql` CLI was required; checks ran through the repository's Node `pg` scripts.
- Android Development Build: historical attempts failed in Reanimated CMake/Ninja; no longer part of the ordinary Expo Go test path.
- iOS Development Build/Simulator: not run; this Windows host has no Xcode or `xcodebuild`. Expo Go on a physical iPhone remains possible from this host when a device is available.
- Expo SQLite Web in a production build on a secure origin with COOP/COEP headers: pending. The local dev response did not include these headers.
- SQLCipher is not enabled or selected. `expo-secure-store` protects keys/values on native platforms; it does not encrypt SQLite. Web has no SecureStore-equivalent native key vault, and WebAssembly SQLite was not encrypted in this test.
- API dependency audit previously passed with zero reported vulnerabilities. The existing mobile audit reports five moderate transitive `glob`/`minimatch` findings; no forced SDK downgrade was applied.

## Neon validation status

Neon connection, migrations 1–3, repeat/checksum validation, schema/domain assertions, per-owner cursor concurrency and test-fixture cleanup passed against the configured development database. The connection string remained local and was not output or committed. Reproduction commands and local environment setup are in [database-setup.md](./database-setup.md).
