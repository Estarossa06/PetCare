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
| 13 | `account_deletion_worker` |

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
| 13 | `account_deletion_worker` |

The legacy path reuses the original migration functions and their checksums.
Only the newly recorded tracking migration is appended at version 12 for that
lineage; no existing ledger row is changed. The merged remote sequence keeps
tracking at version 5 and media storage at version 12. Both lineages append
account deletion at version 13. `pet_tracking` is version 12 only in the
legacy-local lineage and version 5 in the remote lineage.

## Detection and safety

The runner recognizes a lineage from the version-5 row's exact name and
checksum, then validates every applied row's version, name, checksum, and
contiguous order against that lineage before executing DDL. Current SHA-256
checksums canonicalize source/build formatting, so the supported `tsx` runner
and compiled API produce the same value. Existing raw `Function.toString()`
checksums from both historical runtimes are accepted only when the migration
implementation still matches its frozen historical digest; those ledger rows
are never rewritten. Newly applied rows use the canonical digest. A new empty
database defaults to the remote lineage. A mixed, unknown, gapped, duplicated,
or checksum-mismatched history is rejected. A public schema with tables but no
ledger is also rejected rather than treated as new.

Migration status is read-only and reports pending migrations for the selected
lineage. Each pending migration and its ledger row are still applied in the
same transaction. The runner serializes applying migrations with a PostgreSQL
advisory lock so concurrent API instances re-read the committed ledger before
applying work. Re-running the migration command skips validated applied rows
and does not duplicate them.
