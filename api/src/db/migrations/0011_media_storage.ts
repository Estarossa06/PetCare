import type { Migration } from "./types.js";

const migration: Migration = {
  version: 11,
  name: "media_storage",
  async up(client) {
    await client.query(`
      CREATE SEQUENCE media_change_cursor_seq;
      CREATE TABLE media_objects (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        purpose text NOT NULL CHECK (purpose IN ('pet_photo','health_attachment')),
        pet_id uuid NOT NULL,
        health_record_id uuid,
        object_key text NOT NULL UNIQUE,
        original_filename text NOT NULL,
        mime_type text NOT NULL,
        size_bytes bigint NOT NULL CHECK (size_bytes > 0),
        sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        cursor bigint NOT NULL DEFAULT nextval('media_change_cursor_seq') UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT media_objects_owner_id_id_unique UNIQUE (owner_id,id),
        CONSTRAINT media_objects_pet_owner_fk FOREIGN KEY (owner_id,pet_id)
          REFERENCES pets(owner_id,id) ON DELETE RESTRICT,
        CONSTRAINT media_objects_record_owner_fk FOREIGN KEY (owner_id,health_record_id,pet_id)
          REFERENCES health_records(owner_id,id,pet_id) ON DELETE RESTRICT,
        CONSTRAINT media_objects_parent_matches_purpose CHECK (
          (purpose='pet_photo' AND health_record_id IS NULL) OR
          (purpose='health_attachment' AND health_record_id IS NOT NULL)
        ),
        CONSTRAINT media_objects_filename_nonempty CHECK (length(trim(original_filename)) > 0),
        CONSTRAINT media_objects_mime_nonempty CHECK (length(trim(mime_type)) > 0)
      );
      CREATE INDEX media_objects_owner_cursor_idx ON media_objects(owner_id,cursor);
      CREATE UNIQUE INDEX media_objects_active_pet_photo_idx
        ON media_objects(owner_id,pet_id) WHERE purpose='pet_photo' AND deleted_at IS NULL;
      CREATE TABLE media_cleanup_queue (
        object_key text PRIMARY KEY,
        attempt_count integer NOT NULL DEFAULT 0,
        next_retry_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE health_attachments ADD COLUMN remote_storage_key text;
      ALTER TABLE health_attachments ADD COLUMN sha256 char(64);

      CREATE FUNCTION tombstone_pet_media() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
          WITH changed AS (
            UPDATE media_objects SET deleted_at=NEW.deleted_at,updated_at=now(),version=version+1,
              cursor=nextval('media_change_cursor_seq')
            WHERE owner_id=NEW.owner_id AND pet_id=NEW.id AND deleted_at IS NULL
            RETURNING object_key,id,purpose
          )
          INSERT INTO media_cleanup_queue(object_key) SELECT object_key FROM changed;
          UPDATE health_attachments SET deleted_at=NEW.deleted_at,updated_at=now()
            WHERE owner_id=NEW.owner_id AND pet_id=NEW.id AND deleted_at IS NULL;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pets_tombstone_media AFTER UPDATE OF deleted_at ON pets
        FOR EACH ROW EXECUTE FUNCTION tombstone_pet_media();

      CREATE FUNCTION tombstone_record_media() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
          WITH changed AS (
            UPDATE media_objects SET deleted_at=NEW.deleted_at,updated_at=now(),version=version+1,
              cursor=nextval('media_change_cursor_seq')
            WHERE owner_id=NEW.owner_id AND health_record_id=NEW.id AND deleted_at IS NULL
            RETURNING object_key
          )
          INSERT INTO media_cleanup_queue(object_key) SELECT object_key FROM changed;
          UPDATE health_attachments SET deleted_at=NEW.deleted_at,updated_at=now()
            WHERE owner_id=NEW.owner_id AND health_record_id=NEW.id AND deleted_at IS NULL;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER health_records_tombstone_media AFTER UPDATE OF deleted_at ON health_records
        FOR EACH ROW EXECUTE FUNCTION tombstone_record_media();
    `);
  },
};

export default migration;
