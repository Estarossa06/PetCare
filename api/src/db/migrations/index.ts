import core from "./0001_core.js";
import syncSupport from "./0002_sync_support.js";
import orderedSyncCursors from "./0003_ordered_sync_cursors.js";
import authRefreshTokenHistory from "./0004_auth_refresh_token_history.js";
import type { Migration } from "./types.js";

export const migrations: Migration[] = [
  core,
  syncSupport,
  orderedSyncCursors,
  authRefreshTokenHistory,
];
