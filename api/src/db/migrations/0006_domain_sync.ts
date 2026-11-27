import type { Migration } from "./types.js";

const migration: Migration = {
  version: 6,
  name: "domain_sync_entities",
  async up(client) {
    await client.query(`
      ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_entity_type_valid;
      ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_entity_type_valid CHECK (entity_type IN (
        'pet','health_record','care_task','care_execution','appointment','calendar_event','calendar_reminder'
      ));

      ALTER TABLE health_records
        ADD COLUMN clinic_name text,
        ADD COLUMN observations text,
        ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
        ADD COLUMN next_event_at timestamptz,
        ADD COLUMN record_subtype text CHECK (record_subtype IS NULL OR record_subtype='exam');
      ALTER TABLE care_tasks
        ADD COLUMN category text NOT NULL DEFAULT 'custom',
        ADD COLUMN description text,
        ADD COLUMN observations text,
        ADD COLUMN schedule jsonb NOT NULL DEFAULT '{"frequency":"once","interval":1,"unit":"days"}'::jsonb CHECK (jsonb_typeof(schedule)='object'),
        ADD COLUMN next_run_at timestamptz,
        ADD COLUMN ends_at timestamptz;
      ALTER TABLE care_tasks ADD CONSTRAINT care_tasks_category_valid CHECK (category IN (
        'feeding','walk','bath','hygiene','medication','vaccination','deworming','exercise','custom'
      ));

      CREATE TABLE care_task_executions (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL,
        task_id uuid NOT NULL,
        pet_id uuid NOT NULL,
        scheduled_for timestamptz NOT NULL,
        executed_at timestamptz,
        status text NOT NULL CHECK (status IN ('completed','omitted','cancelled')),
        notes text,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        UNIQUE(owner_id,id), UNIQUE(owner_id,task_id,scheduled_for),
        FOREIGN KEY(owner_id,task_id,pet_id) REFERENCES care_tasks(owner_id,id,pet_id) ON DELETE RESTRICT,
        CHECK ((status='completed' AND executed_at IS NOT NULL) OR (status<>'completed' AND executed_at IS NULL))
      );
      CREATE INDEX care_task_executions_pet_time_idx ON care_task_executions(owner_id,pet_id,scheduled_for DESC) WHERE deleted_at IS NULL;

      ALTER TABLE appointments ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';
      CREATE TABLE calendar_events (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, pet_id uuid,
        title text NOT NULL CHECK(length(trim(title))>0), description text,
        category text NOT NULL CHECK(category IN ('custom','birthday','travel','grooming','other')),
        starts_at timestamptz NOT NULL, ends_at timestamptz, timezone text NOT NULL CHECK(length(trim(timezone))>0),
        status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
        observations text, version integer NOT NULL DEFAULT 1 CHECK(version>0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
        UNIQUE(owner_id,id), FOREIGN KEY(owner_id,pet_id) REFERENCES pets(owner_id,id) ON DELETE RESTRICT,
        CHECK(ends_at IS NULL OR ends_at>starts_at)
      );
      CREATE INDEX calendar_events_owner_start_idx ON calendar_events(owner_id,starts_at) WHERE deleted_at IS NULL;

      CREATE TABLE calendar_reminders (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, pet_id uuid,
        calendar_event_id uuid, care_task_id uuid, appointment_id uuid, health_record_id uuid,
        title text NOT NULL CHECK(length(trim(title))>0), remind_at timestamptz NOT NULL,
        lead_minutes integer CHECK(lead_minutes IS NULL OR lead_minutes>=0), timezone text NOT NULL CHECK(length(trim(timezone))>0),
        status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','attended','cancelled')),
        enabled boolean NOT NULL DEFAULT true, notes text, version integer NOT NULL DEFAULT 1 CHECK(version>0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
        UNIQUE(owner_id,id),
        CHECK ((calendar_event_id IS NOT NULL)::int+(care_task_id IS NOT NULL)::int+(appointment_id IS NOT NULL)::int+(health_record_id IS NOT NULL)::int=1),
        CHECK (calendar_event_id IS NOT NULL OR pet_id IS NOT NULL),
        FOREIGN KEY(owner_id,pet_id) REFERENCES pets(owner_id,id) ON DELETE RESTRICT,
        FOREIGN KEY(owner_id,calendar_event_id) REFERENCES calendar_events(owner_id,id) ON DELETE RESTRICT,
        FOREIGN KEY(owner_id,care_task_id,pet_id) REFERENCES care_tasks(owner_id,id,pet_id) ON DELETE RESTRICT,
        FOREIGN KEY(owner_id,appointment_id,pet_id) REFERENCES appointments(owner_id,id,pet_id) ON DELETE RESTRICT,
        FOREIGN KEY(owner_id,health_record_id,pet_id) REFERENCES health_records(owner_id,id,pet_id) ON DELETE RESTRICT
      );
      CREATE INDEX calendar_reminders_due_idx ON calendar_reminders(owner_id,remind_at) WHERE status='pending' AND enabled AND deleted_at IS NULL;

      CREATE FUNCTION record_domain_sync_change() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE next_cursor bigint; op_id uuid; fields jsonb; kind text;
      BEGIN
        kind := TG_ARGV[0];
        op_id := nullif(current_setting('petcare.sync_operation_id',true),'')::uuid;
        fields := coalesce(nullif(current_setting('petcare.sync_changed_fields',true),'')::jsonb,'[]'::jsonb);
        INSERT INTO sync_cursors(owner_id,last_cursor) VALUES(NEW.owner_id,1)
          ON CONFLICT(owner_id) DO UPDATE SET last_cursor=sync_cursors.last_cursor+1,updated_at=now() RETURNING last_cursor INTO next_cursor;
        INSERT INTO sync_changes(owner_id,cursor,entity_type,entity_id,entity_version,operation_id,change_type,changed_fields)
          VALUES(NEW.owner_id,next_cursor,kind,NEW.id,NEW.version,op_id,CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,fields);
        RETURN NEW;
      END $$;
      CREATE TRIGGER health_records_sync AFTER INSERT OR UPDATE ON health_records FOR EACH ROW EXECUTE FUNCTION record_domain_sync_change('health_record');
      CREATE TRIGGER care_tasks_sync AFTER INSERT OR UPDATE ON care_tasks FOR EACH ROW EXECUTE FUNCTION record_domain_sync_change('care_task');
      CREATE TRIGGER care_task_executions_sync AFTER INSERT OR UPDATE ON care_task_executions FOR EACH ROW EXECUTE FUNCTION record_domain_sync_change('care_execution');
      CREATE TRIGGER appointments_sync AFTER INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION record_domain_sync_change('appointment');
      CREATE TRIGGER calendar_events_sync AFTER INSERT OR UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION record_domain_sync_change('calendar_event');
      CREATE TRIGGER calendar_reminders_sync AFTER INSERT OR UPDATE ON calendar_reminders FOR EACH ROW EXECUTE FUNCTION record_domain_sync_change('calendar_reminder');

      -- Seed the feed for domain rows that existed before clients supported these entities.
      UPDATE health_records SET updated_at=updated_at;
      UPDATE care_tasks SET updated_at=updated_at;
      UPDATE care_task_executions SET updated_at=updated_at;
      UPDATE appointments SET updated_at=updated_at;
      UPDATE calendar_events SET updated_at=updated_at;
      UPDATE calendar_reminders SET updated_at=updated_at;
    `);
  },
};

export default migration;
