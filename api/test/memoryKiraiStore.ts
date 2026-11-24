import { randomUUID } from "node:crypto";
import type { KiraiConversation, KiraiPreparedRequest, KiraiStore, KiraiStoredMessage } from "../src/modules/kirai/repository.js";
import type { KiraiHistoryMessage } from "../src/modules/kirai/validation.js";
import { KiraiIdempotencyConflictError, KiraiNotFoundError } from "../src/modules/kirai/repository.js";

export class MemoryKiraiStore implements KiraiStore {
  readonly conversations = new Map<string, { ownerId: string; value: KiraiConversation }>();
  readonly messages: KiraiStoredMessage[] = [];
  readonly answersByUserMessage = new Map<string, string>();

  async prepareRequest(input: { ownerId: string; conversationId: string; requestId: string; message: string }): Promise<KiraiPreparedRequest> {
    const existing = this.messages.find((message) => message.requestId === input.requestId && this.ownerOf(message.conversationId) === input.ownerId);
    if (existing) {
      if (existing.conversationId !== input.conversationId || existing.content !== input.message) throw new KiraiIdempotencyConflictError();
      return { conversationId: existing.conversationId, message: existing, answer: this.messages.find((message) => message.id === this.answersByUserMessage.get(existing.id)) };
    }
    const current = this.conversations.get(input.conversationId);
    if (current && current.ownerId !== input.ownerId) throw new KiraiNotFoundError();
    const now = new Date().toISOString();
    if (!current) this.conversations.set(input.conversationId, { ownerId: input.ownerId, value: { id: input.conversationId, title: input.message.slice(0, 100), createdAt: now, updatedAt: now, lastMessageAt: now } });
    const message: KiraiStoredMessage = { id: randomUUID(), conversationId: input.conversationId, role: "user", content: input.message, createdAt: now, requestId: input.requestId, replyToMessageId: null, requestStatus: "pending", truncated: false };
    this.messages.push(message);
    return { conversationId: input.conversationId, message };
  }

  async conversationHistory(ownerId: string, conversationId: string, before: KiraiStoredMessage): Promise<KiraiHistoryMessage[]> {
    const rows = this.messages.filter((message) => message.conversationId === conversationId && this.ownerOf(conversationId) === ownerId && message.role === "user" && message.requestStatus === "complete" && message.createdAt < before.createdAt)
      .slice(-5);
    return rows.flatMap((question) => {
      const index = this.messages.indexOf(question);
      const answer = this.messages[index + 1];
      return answer?.role === "assistant" ? [{ role: "user" as const, content: question.content }, { role: "assistant" as const, content: answer.content }] : [];
    });
  }

  async saveAnswer(ownerId: string, userMessage: KiraiStoredMessage, content: string, truncated: boolean): Promise<KiraiStoredMessage> {
    if (this.ownerOf(userMessage.conversationId) !== ownerId) throw new Error("NOT_FOUND");
    const existingId = this.answersByUserMessage.get(userMessage.id);
    const existing = this.messages.find((message) => message.id === existingId);
    if (existing) return existing;
    const answer: KiraiStoredMessage = { id: randomUUID(), conversationId: userMessage.conversationId, role: "assistant", content, createdAt: new Date().toISOString(), requestId: null, replyToMessageId: userMessage.id, requestStatus: null, truncated };
    this.messages.push(answer);
    this.answersByUserMessage.set(userMessage.id, answer.id);
    userMessage.requestStatus = "complete";
    const conversation = this.conversations.get(userMessage.conversationId);
    if (conversation) conversation.value.updatedAt = conversation.value.lastMessageAt = answer.createdAt;
    return answer;
  }

  async markFailed(_ownerId: string, messageId: string): Promise<void> {
    const message = this.messages.find((item) => item.id === messageId);
    if (message) message.requestStatus = "failed";
  }

  async listConversations(ownerId: string): Promise<KiraiConversation[]> {
    return [...this.conversations.values()].filter((item) => item.ownerId === ownerId).map((item) => item.value);
  }

  async listMessages(ownerId: string, conversationId: string, offset: number, limit: number) {
    const rows = this.messages.filter((message) => message.conversationId === conversationId && this.ownerOf(conversationId) === ownerId);
    if (!this.conversations.has(conversationId) || this.ownerOf(conversationId) !== ownerId) throw new KiraiNotFoundError();
    return { messages: rows.slice(offset, offset + limit), hasMore: rows.length > offset + limit };
  }

  private ownerOf(conversationId: string): string | undefined { return this.conversations.get(conversationId)?.ownerId; }
}
