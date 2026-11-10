import type { Migration } from "./types.js";

const migration: Migration = {
  version: 1,
  name: "core",
  async up(client) {
    await client.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL,
        password_hash text NOT NULL,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
        CONSTRAINT users_email_nonempty CHECK (length(trim(email)) > 0),
        CONSTRAINT users_password_hash_nonempty CHECK (length(password_hash) > 0),
        CONSTRAINT users_name_nonempty CHECK (length(trim(name)) > 0)
      );
      CREATE UNIQUE INDEX users_email_unique_idx ON users (email);

      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        refresh_token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT auth_sessions_token_hash_nonempty CHECK (length(refresh_token_hash) > 0),
        CONSTRAINT auth_sessions_expiry_after_creation CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_sessions_user_active_idx
        ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

      CREATE TABLE pets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        name text NOT NULL,
        species text NOT NULL,
        breed text,
        sex text,
        birth_date date,
        approximate_age_months integer,
        weight_kg numeric(7, 3),
        color text,
        notes text,
        photo_storage_key text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT pets_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT pets_name_nonempty CHECK (length(trim(name)) > 0),
        CONSTRAINT pets_species_nonempty CHECK (length(trim(species)) > 0),
        CONSTRAINT pets_sex_valid CHECK (sex IS NULL OR sex IN ('female', 'male', 'unknown')),
        CONSTRAINT pets_age_nonnegative CHECK (approximate_age_months IS NULL OR approximate_age_months >= 0),
        CONSTRAINT pets_weight_positive CHECK (weight_kg IS NULL OR weight_kg > 0),
        CONSTRAINT pets_version_positive CHECK (version > 0)
      );
      CREATE INDEX pets_owner_updated_idx ON pets (owner_id, updated_at DESC);

      CREATE TABLE health_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        record_type text NOT NULL,
        title text NOT NULL,
        description text,
        occurred_at timestamptz NOT NULL,
        professional_name text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT health_records_pet_owner_fk
          FOREIGN KEY (owner_id, pet_id) REFERENCES pets(owner_id, id) ON DELETE RESTRICT,
        CONSTRAINT health_records_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT health_records_owner_id_id_pet_unique UNIQUE (owner_id, id, pet_id),
        CONSTRAINT health_records_type_valid CHECK (
          record_type IN ('consultation', 'vaccination', 'deworming', 'medication',
            'treatment', 'surgery', 'allergy', 'diagnosis', 'observation')
        ),
        CONSTRAINT health_records_title_nonempty CHECK (length(trim(title)) > 0),
        CONSTRAINT health_records_version_positive CHECK (version > 0)
      );
      CREATE INDEX health_records_pet_date_idx
        ON health_records (owner_id, pet_id, occurred_at DESC);

      CREATE TABLE health_attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        health_record_id uuid NOT NULL,
        storage_key text NOT NULL,
        original_filename text NOT NULL,
        mime_type text NOT NULL,
        size_bytes bigint NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT health_attachments_record_owner_fk
          FOREIGN KEY (owner_id, health_record_id, pet_id)
          REFERENCES health_records(owner_id, id, pet_id) ON DELETE RESTRICT,
        CONSTRAINT health_attachments_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT health_attachments_storage_key_nonempty CHECK (length(trim(storage_key)) > 0),
        CONSTRAINT health_attachments_filename_nonempty CHECK (length(trim(original_filename)) > 0),
        CONSTRAINT health_attachments_mime_nonempty CHECK (length(trim(mime_type)) > 0),
        CONSTRAINT health_attachments_size_positive CHECK (size_bytes > 0),
        CONSTRAINT health_attachments_version_positive CHECK (version > 0)
      );
      CREATE INDEX health_attachments_record_idx
        ON health_attachments (owner_id, health_record_id);

      CREATE TABLE care_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        task_type text NOT NULL,
        title text NOT NULL,
        notes text,
        recurrence_rule text,
        timezone text NOT NULL DEFAULT 'UTC',
        starts_at timestamptz NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT care_tasks_pet_owner_fk
          FOREIGN KEY (owner_id, pet_id) REFERENCES pets(owner_id, id) ON DELETE RESTRICT,
        CONSTRAINT care_tasks_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT care_tasks_owner_id_id_pet_unique UNIQUE (owner_id, id, pet_id),
        CONSTRAINT care_tasks_type_valid CHECK (
          task_type IN ('feeding', 'hygiene', 'bath', 'walk', 'medication',
            'deworming', 'vaccination', 'custom')
        ),
        CONSTRAINT care_tasks_title_nonempty CHECK (length(trim(title)) > 0),
        CONSTRAINT care_tasks_timezone_nonempty CHECK (length(trim(timezone)) > 0),
        CONSTRAINT care_tasks_version_positive CHECK (version > 0)
      );
      CREATE INDEX care_tasks_pet_enabled_idx
        ON care_tasks (owner_id, pet_id, starts_at) WHERE enabled AND deleted_at IS NULL;

      CREATE TABLE appointments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        title text NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz,
        location text,
        notes text,
        status text NOT NULL DEFAULT 'scheduled',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT appointments_pet_owner_fk
          FOREIGN KEY (owner_id, pet_id) REFERENCES pets(owner_id, id) ON DELETE RESTRICT,
        CONSTRAINT appointments_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT appointments_owner_id_id_pet_unique UNIQUE (owner_id, id, pet_id),
        CONSTRAINT appointments_title_nonempty CHECK (length(trim(title)) > 0),
        CONSTRAINT appointments_end_after_start CHECK (ends_at IS NULL OR ends_at > starts_at),
        CONSTRAINT appointments_status_valid CHECK (status IN ('scheduled', 'completed', 'cancelled')),
        CONSTRAINT appointments_version_positive CHECK (version > 0)
      );
      CREATE INDEX appointments_pet_start_idx
        ON appointments (owner_id, pet_id, starts_at) WHERE deleted_at IS NULL;

      CREATE TABLE reminders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        care_task_id uuid,
        appointment_id uuid,
        title text NOT NULL,
        due_at timestamptz NOT NULL,
        timezone text NOT NULL DEFAULT 'UTC',
        status text NOT NULL DEFAULT 'pending',
        notes text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT reminders_pet_owner_fk
          FOREIGN KEY (owner_id, pet_id) REFERENCES pets(owner_id, id) ON DELETE RESTRICT,
        CONSTRAINT reminders_care_task_owner_pet_fk
          FOREIGN KEY (owner_id, care_task_id, pet_id)
          REFERENCES care_tasks(owner_id, id, pet_id) ON DELETE RESTRICT,
        CONSTRAINT reminders_appointment_owner_pet_fk
          FOREIGN KEY (owner_id, appointment_id, pet_id)
          REFERENCES appointments(owner_id, id, pet_id) ON DELETE RESTRICT,
        CONSTRAINT reminders_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT reminders_single_source CHECK (care_task_id IS NULL OR appointment_id IS NULL),
        CONSTRAINT reminders_title_nonempty CHECK (length(trim(title)) > 0),
        CONSTRAINT reminders_timezone_nonempty CHECK (length(trim(timezone)) > 0),
        CONSTRAINT reminders_status_valid CHECK (status IN ('pending', 'completed', 'cancelled')),
        CONSTRAINT reminders_version_positive CHECK (version > 0)
      );
      CREATE INDEX reminders_pet_due_idx
        ON reminders (owner_id, pet_id, due_at) WHERE status = 'pending' AND deleted_at IS NULL;

      CREATE TABLE ai_conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        title text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT ai_conversations_pet_owner_fk
          FOREIGN KEY (owner_id, pet_id) REFERENCES pets(owner_id, id) ON DELETE RESTRICT,
        CONSTRAINT ai_conversations_owner_id_id_unique UNIQUE (owner_id, id),
        CONSTRAINT ai_conversations_owner_id_id_pet_unique UNIQUE (owner_id, id, pet_id),
        CONSTRAINT ai_conversations_version_positive CHECK (version > 0)
      );
      CREATE INDEX ai_conversations_pet_updated_idx
        ON ai_conversations (owner_id, pet_id, updated_at DESC);

      CREATE TABLE ai_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        role text NOT NULL,
        content text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT ai_messages_conversation_owner_pet_fk
          FOREIGN KEY (owner_id, conversation_id, pet_id)
          REFERENCES ai_conversations(owner_id, id, pet_id) ON DELETE RESTRICT,
        CONSTRAINT ai_messages_role_valid CHECK (role IN ('user', 'assistant')),
        CONSTRAINT ai_messages_content_nonempty CHECK (length(trim(content)) > 0),
        CONSTRAINT ai_messages_version_positive CHECK (version > 0)
      );
      CREATE INDEX ai_messages_conversation_created_idx
        ON ai_messages (owner_id, conversation_id, created_at);
    `);
  },
};

export default migration;
