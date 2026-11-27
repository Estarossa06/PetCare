# PostgreSQL migration lineages

PetCare has two valid PostgreSQL histories because the local migration branch
and the remote `main` branch both used version 5 for different migrations.
Applied `schema_migrations` rows are immutable: the runner never renumbers,
renames, deletes, or rewrites an applied row.

## Remote lineage (canonical for new databases)

| Version | Name |
| ---: | --- |
| 1–4 | `core`, `sync_support`, `ordered_sync_cursors`, `auth_refresh_token_history` |
| 5 | `pet_tracking` |
| 6 | `pet_sync_protocol` |
| 7 | `domain_sync_entities` |
| 8 | `domain_sync_legacy_category_backfill` |
| 9 | `preserve_existing_sync_entity_types` |
| 10 | `account_lifecycle` |
| 11 | `kirai_conversations` |
| 12 | `media_storage` |

## Legacy local lineage

| Version | Name |
| ---: | --- |
| 1–4 | `core`, `sync_support`, `ordered_sync_cursors`, `auth_refresh_token_history` |
| 5 | `pet_sync_protocol` |
| 6 | `domain_sync_entities` |
| 7 | `domain_sync_legacy_category_backfill` |
| 8 | `preserve_existing_sync_entity_types` |
| 9 | `account_lifecycle` |
| 10 | `kirai_conversations` |
| 11 | `media_storage` |
| 12 | `pet_tracking` |

The legacy path reuses the original migration functions and their checksums.
Only the newly recorded tracking migration is appended at version 12 for that
lineage; no existing ledger row is changed. The merged remote sequence keeps
tracking at version 5 and media storage at version 12.

## Detection and safety

The runner recognizes a lineage from the version-5 row's exact name and
checksum, then validates every applied row's version, name, checksum, and
contiguous order against that lineage before executing DDL. A new empty
database defaults to the remote lineage. A mixed, unknown, gapped, duplicated,
or checksum-mismatched history is rejected. A public schema with tables but no
ledger is also rejected rather than treated as new.

Migration status is read-only and reports pending migrations for the selected
lineage. Each pending migration and its ledger row are still applied in the
same transaction. Re-running the migration command skips validated applied
rows and does not duplicate them.
