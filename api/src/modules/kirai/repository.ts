import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { Queryable } from "../../db/queryable.js";
import type { KiraiHistoryMessage } from "./validation.js";

export interface KiraiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface KiraiStoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  requestId: string | null;
  replyToMessageId: string | null;
  requestStatus: "pending" | "failed" | "complete" | null;
  truncated: boolean;
}

export interface KiraiPreparedRequest {
  conversationId: string;
  message: KiraiStoredMessage;
  answer?: KiraiStoredMessage;
}

export interface KiraiStore {
  prepareRequest(input: { ownerId: string; conversationId: string; requestId: string; message: string }): Promise<KiraiPreparedRequest>;
  conversationHistory(ownerId: string, conversationId: string, before: KiraiStoredMessage): Promise<KiraiHistoryMessage[]>;
  saveAnswer(ownerId: string, userMessage: KiraiStoredMessage, content: string, truncated: boolean): Promise<KiraiStoredMessage>;
  markFailed(ownerId: string, messageId: string): Promise<void>;
  listConversations(ownerId: string): Promise<KiraiConversation[]>;
  listMessages(ownerId: string, conversationId: string, offset: number, limit: number): Promise<{ messages: KiraiStoredMessage[]; hasMore: boolean }>;
}

interface ConversationRow extends QueryResultRow {
  id: string; title: string; created_at: Date | string; updated_at: Date | string; last_message_at?: Date | string;
}
interface MessageRow extends QueryResultRow {
  id: string; conversation_id: string; role: "user" | "assistant"; content: string;
  created_at: Date | string; client_request_id: string | null; request_status: "pending" | "failed" | "complete" | null;
  reply_to_message_id: string | null; truncated: boolean;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function toMessage(row: MessageRow): KiraiStoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: iso(row.created_at),
    requestId: row.client_request_id,
    replyToMessageId: row.reply_to_message_id,
    requestStatus: row.request_status,
    truncated: row.truncated,
  };
}

export class KiraiNotFoundError extends Error { readonly code = "KIRAI_NOT_FOUND"; }
export class KiraiIdempotencyConflictError extends Error { readonly code = "IDEMPOTENCY_CONFLICT"; }

export class PostgresKiraiStore implements KiraiStore {
  constructor(private readonly database: Queryable) {}

  async prepareRequest(input: { ownerId: string; conversationId: string; requestId: string; message: string }): Promise<KiraiPreparedRequest> {
    const existing = await this.database.query<MessageRow>(
      `SELECT id, conversation_id, role, content, created_at, client_request_id, reply_to_message_id, request_status, truncated
       FROM kirai_messages WHERE owner_id=$1 AND client_request_id=$2`,
      [input.ownerId, input.requestId],
    );
    if (existing.rows[0]) {
      const message = toMessage(existing.rows[0]);
      if (message.conversationId !== input.conversationId || message.content !== input.message) throw new KiraiIdempotencyConflictError();
      return { conversationId: message.conversationId, message, answer: await this.findAnswer(input.ownerId, message.id) };
    }

    const conversation = await this.database.query<{ id: string } & QueryResultRow>(
      "SELECT id::text FROM kirai_conversations WHERE id=$1 AND owner_id=$2",
      [input.conversationId, input.ownerId],
    );
    if (!conversation.rows[0]) {
      await this.database.query(
        "INSERT INTO kirai_conversations(id,owner_id,title) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
        [input.conversationId, input.ownerId, input.message.slice(0, 100)],
      );
      const ownerCheck = await this.database.query<{ id: string } & QueryResultRow>(
        "SELECT id::text FROM kirai_conversations WHERE id=$1 AND owner_id=$2",
        [input.conversationId, input.ownerId],
      );
      if (!ownerCheck.rows[0]) throw new KiraiNotFoundError();
    }

    const inserted = await this.database.query<MessageRow>(
      `INSERT INTO kirai_messages(id,owner_id,conversation_id,role,content,client_request_id,request_status)
       VALUES($1,$2,$3,'user',$4,$5,'pending')
       ON CONFLICT(owner_id,client_request_id) DO NOTHING
       RETURNING id, conversation_id, role, content, created_at, client_request_id, reply_to_message_id, request_status, truncated`,
      [randomUUID(), input.ownerId, input.conversationId, input.message, input.requestId],
    );
    if (inserted.rows[0]) return { conversationId: input.conversationId, message: toMessage(inserted.rows[0]) };

    const raced = await this.database.query<MessageRow>(
      `SELECT id, conversation_id, role, content, created_at, client_request_id, reply_to_message_id, request_status, truncated
       FROM kirai_messages WHERE owner_id=$1 AND client_request_id=$2`,
      [input.ownerId, input.requestId],
    );
    if (!raced.rows[0]) throw new Error("KIRAI request could not be persisted.");
    const message = toMessage(raced.rows[0]);
    if (message.conversationId !== input.conversationId || message.content !== input.message) throw new KiraiIdempotencyConflictError();
    return { conversationId: message.conversationId, message, answer: await this.findAnswer(input.ownerId, message.id) };
  }

  async conversationHistory(ownerId: string, conversationId: string, before: KiraiStoredMessage): Promise<KiraiHistoryMessage[]> {
    const result = await this.database.query<{ question: string; answer: string } & QueryResultRow>(
      `SELECT question.content AS question, answer.content AS answer
       FROM kirai_messages question
       JOIN kirai_messages answer ON answer.owner_id=question.owner_id AND answer.reply_to_message_id=question.id
       WHERE question.owner_id=$1 AND question.conversation_id=$2 AND question.role='user'
         AND question.request_status='complete'
         AND (question.created_at, question.id) < ($3::timestamptz, $4::uuid)
       ORDER BY question.created_at DESC, question.id DESC LIMIT 5`,
      [ownerId, conversationId, before.createdAt, before.id],
    );
    return result.rows.reverse().flatMap((row) => [
      { role: "user" as const, content: row.question },
      { role: "assistant" as const, content: row.answer },
    ]);
  }

  async saveAnswer(ownerId: string, userMessage: KiraiStoredMessage, content: string, truncated: boolean): Promise<KiraiStoredMessage> {
    await this.database.query(
      `INSERT INTO kirai_messages(id,owner_id,conversation_id,role,content,reply_to_message_id,truncated)
       VALUES($1,$2,$3,'assistant',$4,$5,$6) ON CONFLICT(owner_id,reply_to_message_id) DO NOTHING`,
      [randomUUID(), ownerId, userMessage.conversationId, content, userMessage.id, truncated],
    );
    await this.database.query(
      "UPDATE kirai_messages SET request_status='complete' WHERE owner_id=$1 AND id=$2",
      [ownerId, userMessage.id],
    );
    await this.database.query(
      "UPDATE kirai_conversations SET updated_at=now() WHERE owner_id=$1 AND id=$2",
      [ownerId, userMessage.conversationId],
    );
    const answer = await this.findAnswer(ownerId, userMessage.id);
    if (!answer) throw new Error("KIRAI response could not be persisted.");
    return answer;
  }

  async markFailed(ownerId: string, messageId: string): Promise<void> {
    await this.database.query(
      "UPDATE kirai_messages SET request_status='failed' WHERE owner_id=$1 AND id=$2 AND role='user' AND request_status='pending'",
      [ownerId, messageId],
    );
  }

  async listConversations(ownerId: string): Promise<KiraiConversation[]> {
    const result = await this.database.query<ConversationRow>(
      `SELECT conversation.id, conversation.title, conversation.created_at, conversation.updated_at,
        coalesce(max(message.created_at), conversation.updated_at) AS last_message_at
       FROM kirai_conversations conversation
       LEFT JOIN kirai_messages message ON message.owner_id=conversation.owner_id AND message.conversation_id=conversation.id
       WHERE conversation.owner_id=$1
       GROUP BY conversation.id ORDER BY last_message_at DESC, conversation.id DESC LIMIT 100`,
      [ownerId],
    );
    return result.rows.map((row) => ({
      id: row.id, title: row.title, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      lastMessageAt: iso(row.last_message_at ?? row.updated_at),
    }));
  }

  async listMessages(ownerId: string, conversationId: string, offset: number, limit: number): Promise<{ messages: KiraiStoredMessage[]; hasMore: boolean }> {
    const exists = await this.database.query<{ id: string } & QueryResultRow>(
      "SELECT id::text FROM kirai_conversations WHERE owner_id=$1 AND id=$2",
      [ownerId, conversationId],
    );
    if (!exists.rows[0]) throw new KiraiNotFoundError();
    const result = await this.database.query<MessageRow>(
      `SELECT id,conversation_id,role,content,created_at,client_request_id,reply_to_message_id,request_status,truncated
       FROM kirai_messages WHERE owner_id=$1 AND conversation_id=$2
       ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
      [ownerId, conversationId, limit + 1, offset],
    );
    return { messages: result.rows.slice(0, limit).reverse().map(toMessage), hasMore: result.rows.length > limit };
  }

  private async findAnswer(ownerId: string, userMessageId: string): Promise<KiraiStoredMessage | undefined> {
    const result = await this.database.query<MessageRow>(
      `SELECT id,conversation_id,role,content,created_at,client_request_id,reply_to_message_id,request_status,truncated
       FROM kirai_messages WHERE owner_id=$1 AND reply_to_message_id=$2`,
      [ownerId, userMessageId],
    );
    return result.rows[0] ? toMessage(result.rows[0]) : undefined;
  }
}
