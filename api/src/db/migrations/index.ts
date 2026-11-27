import core from "./0001_core.js";
import syncSupport from "./0002_sync_support.js";
import orderedSyncCursors from "./0003_ordered_sync_cursors.js";
import authRefreshTokenHistory from "./0004_auth_refresh_token_history.js";
import tracking from "./0005_tracking.js";
import petSyncProtocol from "./0005_pet_sync_protocol.js";
import domainSyncEntities from "./0006_domain_sync.js";
import domainBackfill from "./0007_domain_backfill.js";
import preserveSyncEntityTypes from "./0008_preserve_sync_entity_types.js";
import accountLifecycle from "./0009_account_lifecycle.js";
import kiraiConversations from "./0010_kirai_conversations.js";
import mediaStorage from "./0011_media_storage.js";
import accountDeletionWorker from "./0013_account_deletion_worker.js";
import googleOAuth from "./0014_google_oauth.js";
import type { Migration } from "./types.js";

const commonMigrations = [
  core,
  syncSupport,
  orderedSyncCursors,
  authRefreshTokenHistory,
];

function atVersion(migration: Migration, version: number): Migration {
  return { ...migration, version };
}

/** Canonical merged history used for new databases and the remote v5 lineage. */
export const migrations: Migration[] = [
  ...commonMigrations,
  tracking,
  atVersion(petSyncProtocol, 6),
  atVersion(domainSyncEntities, 7),
  atVersion(domainBackfill, 8),
  atVersion(preserveSyncEntityTypes, 9),
  atVersion(accountLifecycle, 10),
  atVersion(kiraiConversations, 11),
  atVersion(mediaStorage, 12),
  atVersion(accountDeletionWorker, 13),
  googleOAuth,
];

/**
 * Original local sequence for databases whose v5 was pet_sync_protocol.
 * Tracking is appended only for this lineage; all existing local migration
 * objects retain their original filenames, versions, names, and up functions.
 */
export const legacyLocalMigrations: Migration[] = [
  ...commonMigrations,
  petSyncProtocol,
  domainSyncEntities,
  domainBackfill,
  preserveSyncEntityTypes,
  accountLifecycle,
  kiraiConversations,
  mediaStorage,
  atVersion(tracking, 12),
  accountDeletionWorker,
  googleOAuth,
];
