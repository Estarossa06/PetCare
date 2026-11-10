# PetCare

PetCare has one multiplatform Expo client (React Native, Expo Router and TypeScript) targeting Android, iOS and Web, plus an API service. The client uses local SQLite for offline-first persistence; the API is the only component that connects to Neon PostgreSQL. Screens, navigation and business logic are shared; platform differences are isolated behind adapters.

## Persistence setup

See [database setup](./docs/database-setup.md), [data model](./docs/data-model.md), [multiplatform architecture](./docs/multiplatform-architecture.md), [Phase 2 scope](./docs/persistence-phase-2.md), and the [persistence verification report](./docs/persistence-verification.md).

The current Expo Router entry is a temporary SQLite verification harness, not a product screen. The same route is bundled for all platforms. SQLite runtime checks passed in the local Web browser; Android/iOS native validation and production Web hosting with the configured isolation headers remain pending.

Backend migrations are run from `api/` with `npm run db:migrate:status` and `npm run db:migrate`. Set `DATABASE_URL` in an untracked `api/.env` file first. Do not configure Neon credentials in the mobile app.
