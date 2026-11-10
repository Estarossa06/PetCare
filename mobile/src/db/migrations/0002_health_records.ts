import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 2,
  name: "health_record_details_and_exams",
  async up(db) {
    await db.execAsync(`
      ALTER TABLE health_records ADD COLUMN clinic_name TEXT;
      ALTER TABLE health_records ADD COLUMN observations TEXT;
      ALTER TABLE health_records ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json) AND json_type(details_json) = 'object');
      ALTER TABLE health_records ADD COLUMN next_event_at TEXT;
      ALTER TABLE health_records ADD COLUMN record_subtype TEXT
        CHECK (record_subtype IS NULL OR record_subtype = 'exam');
      CREATE INDEX health_records_upcoming_idx
        ON health_records (owner_id, pet_id, next_event_at)
        WHERE next_event_at IS NOT NULL AND deleted_at IS NULL;
    `);
  },
};

export default migration;
