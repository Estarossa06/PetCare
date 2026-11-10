# Database setup and verification

PostgreSQL and SQLite use separate schemas and migration systems. `mobile/` is one Expo application targeting Android, iOS and Web; it is not a mobile-only project with a separate web app. Never point the Expo client at `DATABASE_URL`; only the API migration runner and, later, the API service use the Neon connection string.

## Neon PostgreSQL migrations

1. Create a disposable Neon development/test database and obtain its pooled or direct connection URL.
2. Create and locally edit the ignored environment file:

```powershell
if (-not (Test-Path api\.env)) { Copy-Item api\.env.example api\.env }
notepad api\.env
```

In the editor, replace the placeholder `DATABASE_URL` with the Neon URL, retaining `sslmode=require`. Do not place the URL in shell history or logs, and do not share or commit `api\.env`.

3. From the repository root, install dependencies, check migration status, apply migrations, rerun to verify idempotence/checksums, and check status again:

```powershell
npm install --prefix api
npm run db:migrate:status --prefix api
npm run db:migrate --prefix api
npm run db:migrate --prefix api
npm run db:migrate:status --prefix api
```

There are three backend migrations. The migration ledger is `schema_migrations`; the tables are listed in `docs/data-model.md`.

4. On that same disposable database, run the database assertions:

```powershell
$env:PETCARE_RUN_DB_CHECKS = "1"
npm run db:verify --prefix api
npm run db:verify:cursor --prefix api
Remove-Item Env:\PETCARE_RUN_DB_CHECKS
```

The main verifier tests UUID, owner-aware foreign keys, version checks, soft deletion and physical-delete restriction; the cursor verifier tests concurrent per-owner cursor allocation. They remove their fixtures. Do not run these checks against production.

The runner takes a PostgreSQL advisory lock, applies each migration in a transaction and validates the checksum of previously applied migration source. Do not edit an applied migration; add a new numbered migration instead. The command `npm run build` checks the TypeScript migration runner.

To inspect the resulting schema in Neon SQL Editor, query `information_schema.tables` for `table_schema = 'public'`, and inspect indexes/constraints through `pg_indexes` and `information_schema.table_constraints`. Do not run these commands against production before confirming the target database URL.

Neon credentials are local-only and are not stored in the repository; the development database contains no automatic seed data. Current Neon migration and verification results are recorded in `docs/persistence-verification.md`. A successful local typecheck alone does not establish a remote migration result.

## Local SQLite migration

The migration is called by the future mobile bootstrap after opening the per-install local database:

```ts
await migrateLocalDatabase(database);
await recoverInterruptedSync(database);
```

`database` must expose the async methods defined by `SqliteExecutor` (`execAsync`, `runAsync`, `getFirstAsync`). Foreign-key enforcement is enabled by the migration runner. The migration runs in a `BEGIN IMMEDIATE` transaction and records its version in `_local_migrations`. A failed migration is rolled back and can be retried on next launch.

The single Expo SDK 58 application uses one Expo Router tree for native and web. Its temporary verification route opens `petcare-verification.db` and runs the same migration and verifier on app launch on Android, iOS or Web. `expo-sqlite` is included in the SDK-matched Expo Go client, so normal SQLite development and tests do not require a Development Build.

```powershell
Set-Location mobile
npm install
npx expo install --check
npm start
```

Scan the QR code with Expo Go on a physical Android or iOS device. The device and development server should be on the same network; use `npx expo start --go --tunnel` if the network prevents a LAN connection. A physical iPhone can use this workflow from Windows (Expo Go and Expo CLI must be signed into the same Expo account). `npm run android` requests opening on a connected Android device/emulator; `npm run ios` requests opening in the iOS simulator and therefore needs macOS/Xcode. Neither command compiles an app.

Web bundling and local development use the same project:

```powershell
Set-Location mobile
npm install
npm run typecheck
npx expo export --platform web
npm run web
```

Web SQLite uses Expo's WebAssembly/browser implementation. Local development-browser SQLite runtime has passed. Metro includes `.wasm` assets and the Expo Router plugin configures COOP/COEP headers for compatible Expo Hosting deployments; other hosts need equivalent headers. Production Web remains unvalidated until the harness is run from a secure origin with those headers. Browser storage and encryption are not equivalent to native SQLite/Keychain. Platform-specific storage, key and notification differences are documented in `docs/multiplatform-architecture.md`.

The prepared native validation function is `verifyLocalDatabase(database)` in `mobile/src/db/verify.ts`; it is invoked by the shared harness, which additionally checks CRUD, repeat migration and handle close/reopen persistence. Web browser runtime has passed in the local development environment. Expo Go Android/iOS and production Web runtime remain pending until run on actual devices/hosts; see `docs/persistence-verification.md` for exact results and limitations.

## Environments and test data

Use a separate Neon development/test database for integration testing. No automatic seed data is applied by migrations; production initialization never inserts sample accounts or pets. Test fixtures belong only in the test suite or a separately invoked development-only seed command.
