import type { Migration } from "./types.js";

const migration: Migration = {
  version: 8,
  name: "preserve_existing_sync_entity_types",
  async up(client) {
    await client.query(`
      ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_entity_type_valid;
      ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_entity_type_valid CHECK (entity_type IN (
        'pet','health_record','health_attachment','care_task','care_execution','appointment',
        'reminder','calendar_event','calendar_reminder','ai_conversation','ai_message'
      ));
    `);
  },
};

export default migration;
