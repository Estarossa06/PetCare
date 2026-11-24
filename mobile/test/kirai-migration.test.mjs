import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import migration from "../src/db/migrations/0009_kirai_conversations.ts";

test("KIRAI migration persists owner-scoped conversations and idempotent message links", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const ownerA = "00000000-0000-4000-8000-000000000001";
  const ownerB = "00000000-0000-4000-8000-000000000002";
  const conversation = "00000000-0000-4000-8000-000000000003";
  const question = "00000000-0000-4000-8000-000000000004";
  try {
    await migration.up({ execAsync: async (sql) => db.exec(sql) });
    const insertConversation = db.prepare("INSERT INTO kirai_conversations(id, owner_id, title, created_at, updated_at) VALUES(?, ?, ?, 'now', 'now')");
    insertConversation.run(conversation, ownerA, "Conversación");
    assert.throws(() => insertConversation.run(conversation, ownerB, "Conversación duplicada"));

    const insertMessage = db.prepare(`INSERT INTO kirai_messages(id, owner_id, conversation_id, role, content, client_request_id, request_status, created_at)
      VALUES(?, ?, ?, 'user', ?, ?, 'pending', 'now')`);
    insertMessage.run(question, ownerA, conversation, "Pregunta", "request-1");
    assert.throws(() => insertMessage.run("00000000-0000-4000-8000-000000000005", ownerA, conversation, "Reintento duplicado", "request-1"));
    const uniqueIndexes = db.prepare("PRAGMA index_list(kirai_messages)").all().filter((row) => row.unique);
    const indexedColumns = uniqueIndexes.map((index) => db.prepare(`PRAGMA index_info(${index.name})`).all().map((column) => column.name));
    assert.ok(indexedColumns.some((columns) => columns.join(",") === "owner_id,client_request_id"));
    assert.ok(indexedColumns.some((columns) => columns.join(",") === "owner_id,reply_to_message_id"));
    assert.equal(db.prepare("SELECT count(*) AS count FROM kirai_messages WHERE owner_id=?").get(ownerB).count, 0);
  } finally {
    db.close();
  }
});
