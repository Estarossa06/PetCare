import type { SqliteMigration } from "./types";

const migration: SqliteMigration = {
  version: 9,
  name: "kirai_conversations",
  async up(db) {
    await db.execAsync(`
      CREATE TABLE kirai_conversations (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, id)
      );
      CREATE INDEX kirai_conversations_owner_updated_idx
        ON kirai_conversations(owner_id, updated_at DESC);

      CREATE TABLE kirai_messages (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        client_request_id TEXT,
        reply_to_message_id TEXT,
        request_status TEXT,
        truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, client_request_id),
        UNIQUE (owner_id, reply_to_message_id),
        FOREIGN KEY (owner_id, conversation_id)
          REFERENCES kirai_conversations(owner_id, id),
        FOREIGN KEY (owner_id, reply_to_message_id)
          REFERENCES kirai_messages(owner_id, id),
        CHECK (
          (role = 'user' AND client_request_id IS NOT NULL AND reply_to_message_id IS NULL
            AND request_status IN ('pending', 'failed', 'complete')) OR
          (role = 'assistant' AND client_request_id IS NULL AND reply_to_message_id IS NOT NULL
            AND request_status IS NULL)
        )
      );
      CREATE INDEX kirai_messages_conversation_created_idx
        ON kirai_messages(owner_id, conversation_id, created_at, id);
    `);
  },
};

export default migration;
