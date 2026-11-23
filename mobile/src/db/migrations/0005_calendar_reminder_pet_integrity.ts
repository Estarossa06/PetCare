import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 5,
  name: "calendar_reminder_target_pet_integrity",
  async up(db) {
    await db.execAsync(`
      CREATE UNIQUE INDEX calendar_events_owner_id_pet_idx
        ON calendar_events (owner_id, id, pet_id);

      CREATE TRIGGER calendar_reminders_target_pet_insert
      BEFORE INSERT ON calendar_reminders
      BEGIN
        SELECT CASE WHEN NEW.calendar_event_id IS NOT NULL AND
          (SELECT pet_id FROM calendar_events WHERE owner_id = NEW.owner_id AND id = NEW.calendar_event_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder event pet mismatch') END;
        SELECT CASE WHEN NEW.care_task_id IS NOT NULL AND
          (SELECT pet_id FROM care_tasks WHERE owner_id = NEW.owner_id AND id = NEW.care_task_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder care pet mismatch') END;
        SELECT CASE WHEN NEW.appointment_id IS NOT NULL AND
          (SELECT pet_id FROM appointments WHERE owner_id = NEW.owner_id AND id = NEW.appointment_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder appointment pet mismatch') END;
        SELECT CASE WHEN NEW.health_record_id IS NOT NULL AND
          (SELECT pet_id FROM health_records WHERE owner_id = NEW.owner_id AND id = NEW.health_record_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder medical pet mismatch') END;
      END;

      CREATE TRIGGER calendar_reminders_target_pet_update
      BEFORE UPDATE OF owner_id, pet_id, calendar_event_id, care_task_id, appointment_id, health_record_id
      ON calendar_reminders
      BEGIN
        SELECT CASE WHEN NEW.calendar_event_id IS NOT NULL AND
          (SELECT pet_id FROM calendar_events WHERE owner_id = NEW.owner_id AND id = NEW.calendar_event_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder event pet mismatch') END;
        SELECT CASE WHEN NEW.care_task_id IS NOT NULL AND
          (SELECT pet_id FROM care_tasks WHERE owner_id = NEW.owner_id AND id = NEW.care_task_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder care pet mismatch') END;
        SELECT CASE WHEN NEW.appointment_id IS NOT NULL AND
          (SELECT pet_id FROM appointments WHERE owner_id = NEW.owner_id AND id = NEW.appointment_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder appointment pet mismatch') END;
        SELECT CASE WHEN NEW.health_record_id IS NOT NULL AND
          (SELECT pet_id FROM health_records WHERE owner_id = NEW.owner_id AND id = NEW.health_record_id) IS NOT NEW.pet_id
          THEN RAISE(ABORT, 'calendar reminder medical pet mismatch') END;
      END;
    `);
  },
};

export default migration;
