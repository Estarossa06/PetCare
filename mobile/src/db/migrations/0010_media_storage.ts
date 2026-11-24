import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 10,
  name: "media_storage",
  async up(db) {
    await db.execAsync("ALTER TABLE pets ADD COLUMN photo_remote_asset_id TEXT");
    await db.execAsync("ALTER TABLE health_attachments ADD COLUMN remote_asset_id TEXT");
    await db.execAsync("ALTER TABLE health_attachments ADD COLUMN sha256 TEXT");
    await db.execAsync("ALTER TABLE health_attachments ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'local_only' CHECK (upload_status IN ('local_only','pending','uploading','uploaded','failed','deleted'))");
    await db.execAsync("ALTER TABLE sync_metadata ADD COLUMN media_download_cursor INTEGER NOT NULL DEFAULT 0 CHECK (media_download_cursor >= 0)");
    await db.execAsync(`
      CREATE TABLE media_upload_queue (
        operation_id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('pet_photo','health_attachment')),
        resource_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        health_record_id TEXT,
        action TEXT NOT NULL CHECK (action IN ('upload','delete')),
        local_storage_key TEXT,
        original_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_flight','failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_retry_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_id,operation_id),
        UNIQUE(account_id,asset_id,action,sha256)
      );
      CREATE INDEX media_upload_queue_due_idx ON media_upload_queue(account_id,status,next_retry_at,created_at);
      CREATE INDEX media_upload_queue_resource_idx ON media_upload_queue(account_id,resource_type,resource_id);
    `);
  },
};

export default migration;
