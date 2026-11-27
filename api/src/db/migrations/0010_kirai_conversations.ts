import type { Migration } from "./types.js";

const migration: Migration = {
  version: 10,
  name: "kirai_conversations",
  async up(client) {
    await client.query(`
      CREATE TABLE kirai_conversations (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        title text NOT NULL CHECK (length(trim(title)) > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id, id)
      );
      CREATE INDEX kirai_conversations_owner_updated_idx
        ON kirai_conversations(owner_id, updated_at DESC);

      CREATE TABLE kirai_messages (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        role text NOT NULL CHECK (role IN ('user', 'assistant')),
        content text NOT NULL CHECK (length(trim(content)) > 0),
        client_request_id uuid,
        reply_to_message_id uuid,
        request_status text,
        truncated boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id, id),
        UNIQUE (owner_id, client_request_id),
        UNIQUE (owner_id, reply_to_message_id),
        FOREIGN KEY (owner_id, conversation_id)
          REFERENCES kirai_conversations(owner_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (owner_id, reply_to_message_id)
          REFERENCES kirai_messages(owner_id, id) ON DELETE RESTRICT,
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
