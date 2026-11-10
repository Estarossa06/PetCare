# Persistence implementation — Phase 2

## Implemented

- Versioned TypeScript/Node PostgreSQL migration runner and three ordered backend migrations.
- Initial PostgreSQL domain tables, constraints and query indexes.
- Idempotency receipts, per-device sync cursors and an owner-scoped change feed.
- Initial SQLite domain schema and separate transactional migration runner.
- SQLite sync queue, dependency graph, sync metadata, conflict snapshots and device-local scheduled notification mapping.
- One multiplatform Expo SDK 58 TypeScript app with Expo Router and a shared SQLite migration/verifier harness route for Android, iOS and Web.
- PostgreSQL cursor-ordering migration and a concurrency verification script.
- Example environment file without credentials and database setup/model documentation.

## Not included in this phase

- No Neon connection string or production secret is stored in the repository. The ignored local root `.env` was used for a disposable Neon development database.
- PostgreSQL migrations 1–3, idempotent rerun/checksum status, schema/domain verifier and concurrent cursor verifier all passed against Neon. Fixture rollback/cleanup was explicitly checked.
- SQLite migration, integrity, CRUD, and close/reopen persistence checks passed in the integrated Web browser using the same Expo project. Android native compilation and runtime are still pending; iOS native runtime is untested.
- No API endpoints, complete sync engine, authentication flow, screens, AI provider integration, attachment upload service or seed data.
- SQLite encryption choice remains pending a compatibility spike and native build verification; native secure-key storage and browser storage are not equivalent.

## Validation record

- `npm install --prefix api` — completed; API dependency audit reported zero vulnerabilities.
- `npm run typecheck --prefix api` — passed.
- `npm run build --prefix api` — passed; output is ignored under `api/dist/`.
- Neon TLS socket and certificate authorization check — passed (`encrypted=true`, `authorized=true`).
- `db:migrate` — applied migrations 1–3; second run reported all already applied; final status confirmed all applied.
- `db:verify` — passed table/index/constraint, UUID, owner-FK isolation, version, idempotency-key uniqueness, soft-delete and physical-delete checks. Test fixtures were confirmed absent after rollback.
- `db:verify:cursor` — passed concurrent serialized cursor allocation (`1, 2`) and confirmed fixture cleanup.
- `npm run typecheck` from `mobile/` — passed for the shared Expo app.
- `npx expo-doctor` from `mobile/` — all 20 checks passed.
- Expo export for Web, Android, and iOS — passed as bundle checks; the Web bundle includes the SQLite WebAssembly module.
- Web runtime execution and browser reload — passed SQLite migration, verification, CRUD, logical deletion and database handle close/reopen persistence.
- `api\node_modules\.bin\tsc --noEmit --target ES2022 --moduleResolution bundler --module ESNext --strict mobile\src\db\migrate.ts mobile\src\db\migrations\index.ts` — passed for the SQLite migration modules.
- Executed the initial SQLite DDL using Python's in-memory SQLite engine — passed table creation, foreign-key check, owner isolation constraint and sync dependency relation.
- `npm audit --prefix api` — zero vulnerabilities.
- An initial verifier run found two assertion defects, not migration/schema defects: `ON DELETE RESTRICT` reports SQLSTATE `23001`, and PostgreSQL `count()` returns `bigint`. The expected SQLSTATE was corrected and the cleanup aggregate cast to `int`; both Neon verification scripts then passed. No migrations were changed.
- Android Development Build was attempted twice but Gradle failed in the React Native Reanimated CMake/Ninja task; no AVD/device was available for native runtime checks. iOS native checks require macOS/Xcode.
- Web production runtime with configured secure origin and COOP/COEP headers remains pending; local dev-server runtime passed without those response headers.
- PostgreSQL migrations and verification against Neon remain pending because no local Neon URL is configured.
- The wider Fase 2 remains open pending native Android/iOS SQLite runtime and production-hosted Web SQLite validation.

Never report a remote migration as applied unless the migration command was run successfully against that database.
