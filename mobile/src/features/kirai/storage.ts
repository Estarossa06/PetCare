import * as Crypto from "expo-crypto";
import { getPetCareDatabase } from "../../db/database";
import { getActiveLocalAuthUserId, getLocalAccountId, withLocalWriteTransaction } from "../../db/localAccount";

export type KiraiRole = "user" | "assistant";
export type KiraiRequestStatus = "pending" | "failed" | "complete" | null;
export interface KiraiMessage {
  id: string;
  conversationId: string;
  role: KiraiRole;
  content: string;
  createdAt: string;
  requestId: string | null;
  replyToMessageId: string | null;
  requestStatus: KiraiRequestStatus;
  truncated: boolean;
}
export interface KiraiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

function assertActive(authUserId: string) {
  if (getActiveLocalAuthUserId() !== authUserId) throw new Error("KIRAI account changed while loading its conversation.");
}
function messageFromRow(row: Record<string, unknown>): KiraiMessage {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), role: row.role as KiraiRole,
    content: String(row.content), createdAt: String(row.created_at),
    requestId: row.client_request_id ? String(row.client_request_id) : null,
    replyToMessageId: row.reply_to_message_id ? String(row.reply_to_message_id) : null,
    requestStatus: (row.request_status as KiraiRequestStatus) ?? null,
    truncated: row.truncated === 1 || row.truncated === true,
  };
}

export async function listLocalKiraiConversations(authUserId: string): Promise<KiraiConversation[]> {
  assertActive(authUserId);
  const ownerId = await getLocalAccountId();
  const database = await getPetCareDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    "SELECT id,title,created_at,updated_at,updated_at AS last_message_at FROM kirai_conversations WHERE owner_id=? ORDER BY updated_at DESC,id DESC",
    ownerId,
  );
  assertActive(authUserId);
  return rows.map((row) => ({ id: String(row.id), title: String(row.title), createdAt: String(row.created_at), updatedAt: String(row.updated_at), lastMessageAt: String(row.last_message_at) }));
}

export async function listLocalKiraiMessages(authUserId: string, conversationId: string): Promise<KiraiMessage[]> {
  assertActive(authUserId);
  const ownerId = await getLocalAccountId();
  const database = await getPetCareDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM kirai_messages WHERE owner_id=? AND conversation_id=? ORDER BY created_at,id",
    ownerId, conversationId,
  );
  assertActive(authUserId);
  return rows.map(messageFromRow);
}

export async function cacheKiraiConversations(authUserId: string, conversations: KiraiConversation[]): Promise<void> {
  assertActive(authUserId);
  await withLocalWriteTransaction(async (tx, ownerId) => {
    assertActive(authUserId);
    for (const conversation of conversations) {
      await tx.runAsync(
        `INSERT INTO kirai_conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(owner_id,id) DO UPDATE SET title=excluded.title,updated_at=max(kirai_conversations.updated_at,excluded.updated_at)`,
        conversation.id, ownerId, conversation.title || "Conversación con KIRAI", conversation.createdAt,
        conversation.lastMessageAt || conversation.updatedAt,
      );
    }
  });
}

export async function cacheKiraiMessages(authUserId: string, conversationId: string, messages: KiraiMessage[]): Promise<void> {
  assertActive(authUserId);
  await withLocalWriteTransaction(async (tx, ownerId) => {
    assertActive(authUserId);
    for (const message of messages) {
      if (message.role === "user" && message.requestId) {
        const local = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM kirai_messages WHERE owner_id=? AND client_request_id=?",
          ownerId, message.requestId,
        );
        if (local) {
          if (local.id !== message.id) await tx.runAsync("UPDATE kirai_messages SET id=? WHERE owner_id=? AND id=?", message.id, ownerId, local.id);
          await tx.runAsync(
            "UPDATE kirai_messages SET conversation_id=?,role='user',content=?,created_at=?,request_status=? WHERE owner_id=? AND id=?",
            conversationId, message.content, message.createdAt, message.requestStatus ?? "complete", ownerId, message.id,
          );
          continue;
        }
      }
      if (message.role === "assistant" && message.replyToMessageId) {
        const existingQuestion = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM kirai_messages WHERE owner_id=? AND conversation_id=? AND (id=? OR client_request_id=?)",
          ownerId, conversationId, message.replyToMessageId, message.replyToMessageId,
        );
        const replyTo = existingQuestion?.id ?? message.replyToMessageId;
        await tx.runAsync(
          `INSERT INTO kirai_messages(id,owner_id,conversation_id,role,content,reply_to_message_id,request_status,truncated,created_at)
           VALUES(?,?,?,'assistant',?,?,NULL,?,?) ON CONFLICT(owner_id,reply_to_message_id) DO UPDATE SET content=excluded.content,truncated=excluded.truncated,created_at=excluded.created_at`,
          message.id, ownerId, conversationId, message.content, replyTo, message.truncated ? 1 : 0, message.createdAt,
        );
        continue;
      }
      await tx.runAsync(
        `INSERT INTO kirai_messages(id,owner_id,conversation_id,role,content,client_request_id,reply_to_message_id,request_status,truncated,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET content=excluded.content,request_status=excluded.request_status,truncated=excluded.truncated`,
        message.id, ownerId, conversationId, message.role, message.content, message.requestId,
        message.replyToMessageId, message.requestStatus, message.truncated ? 1 : 0, message.createdAt,
      );
    }
  });
}

export async function savePendingKiraiQuestion(authUserId: string, conversationId: string, requestId: string, content: string): Promise<KiraiMessage> {
  assertActive(authUserId);
  const now = new Date().toISOString();
  return withLocalWriteTransaction(async (tx, ownerId) => {
    assertActive(authUserId);
    await tx.runAsync(
      `INSERT INTO kirai_conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(owner_id,id) DO UPDATE SET updated_at=excluded.updated_at`,
      conversationId, ownerId, content.slice(0, 100), now, now,
    );
    const existing = await tx.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM kirai_messages WHERE owner_id=? AND client_request_id=?",
      ownerId, requestId,
    );
    if (existing) {
      if (existing.conversation_id !== conversationId || existing.content !== content) throw new Error("KIRAI retry does not match its saved question.");
      await tx.runAsync("UPDATE kirai_messages SET request_status='pending' WHERE owner_id=? AND client_request_id=?", ownerId, requestId);
      return { ...messageFromRow(existing), requestStatus: "pending" };
    }
    await tx.runAsync(
      `INSERT INTO kirai_messages(id,owner_id,conversation_id,role,content,client_request_id,request_status,created_at)
       VALUES(?,?,?,'user',?,?,'pending',?)`,
      requestId, ownerId, conversationId, content, requestId, now,
    );
    return { id: requestId, conversationId, role: "user", content, createdAt: now, requestId, replyToMessageId: null, requestStatus: "pending", truncated: false };
  });
}

export async function completePendingKiraiQuestion(authUserId: string, conversationId: string, requestId: string, result: {
  userMessage: { id: string; createdAt: string; content: string };
  assistantMessage: { id: string; createdAt: string; content: string; truncated: boolean };
}): Promise<void> {
  assertActive(authUserId);
  await withLocalWriteTransaction(async (tx, ownerId) => {
    assertActive(authUserId);
    const question = await tx.getFirstAsync<{ id: string }>("SELECT id FROM kirai_messages WHERE owner_id=? AND client_request_id=?", ownerId, requestId);
    if (!question) throw new Error("Saved KIRAI question is missing.");
    const questionId = result.userMessage.id;
    if (question.id !== questionId) await tx.runAsync("UPDATE kirai_messages SET id=? WHERE owner_id=? AND id=?", questionId, ownerId, question.id);
    await tx.runAsync(
      "UPDATE kirai_messages SET content=?,created_at=?,request_status='complete' WHERE owner_id=? AND id=?",
      result.userMessage.content, result.userMessage.createdAt, ownerId, questionId,
    );
    await tx.runAsync(
      `INSERT INTO kirai_messages(id,owner_id,conversation_id,role,content,reply_to_message_id,truncated,created_at)
       VALUES(?,?,?,'assistant',?,?,?,?) ON CONFLICT(owner_id,reply_to_message_id) DO UPDATE SET id=excluded.id,content=excluded.content,truncated=excluded.truncated,created_at=excluded.created_at`,
      result.assistantMessage.id, ownerId, conversationId, result.assistantMessage.content,
      questionId, result.assistantMessage.truncated ? 1 : 0, result.assistantMessage.createdAt,
    );
    await tx.runAsync("UPDATE kirai_conversations SET updated_at=? WHERE owner_id=? AND id=?", result.assistantMessage.createdAt, ownerId, conversationId);
  });
}

export async function failPendingKiraiQuestion(authUserId: string, requestId: string): Promise<void> {
  assertActive(authUserId);
  const ownerId = await getLocalAccountId();
  const database = await getPetCareDatabase();
  assertActive(authUserId);
  await database.runAsync("UPDATE kirai_messages SET request_status='failed' WHERE owner_id=? AND client_request_id=? AND request_status='pending'", ownerId, requestId);
}

export function newKiraiId(): string { return Crypto.randomUUID().toLowerCase(); }
