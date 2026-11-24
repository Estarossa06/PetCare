import { apiClient } from "../auth/apiClient";
import type { KiraiConversation, KiraiMessage } from "./storage";
import type { LocalPetContext } from "./localContext";

export interface KiraiChatResult {
  conversationId: string;
  userMessage: { id: string; content: string; createdAt: string };
  assistantMessage: { id: string; content: string; createdAt: string; truncated: boolean };
  answer: string;
  truncated: boolean;
}

export interface KiraiAvailability {
  available: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function askKirai(
  input: { message: string; conversationId: string; requestId: string; localContext: LocalPetContext },
): Promise<KiraiChatResult> {
  const result = await apiClient.request<unknown>("/kirai/chat", {
    method: "POST",
    body: input,
    authenticated: true,
  });
  if (
    !isRecord(result) ||
    typeof result.conversationId !== "string" ||
    !isRecord(result.userMessage) || typeof result.userMessage.id !== "string" ||
    typeof result.userMessage.content !== "string" || typeof result.userMessage.createdAt !== "string" ||
    !isRecord(result.assistantMessage) || typeof result.assistantMessage.id !== "string" ||
    typeof result.assistantMessage.content !== "string" || typeof result.assistantMessage.createdAt !== "string" ||
    typeof result.assistantMessage.truncated !== "boolean" ||
    typeof result.answer !== "string" ||
    !result.answer.trim() ||
    typeof result.truncated !== "boolean"
  ) {
    throw new Error("The KIRAI response is invalid.");
  }
  return {
    conversationId: result.conversationId,
    userMessage: result.userMessage as KiraiChatResult["userMessage"],
    assistantMessage: result.assistantMessage as KiraiChatResult["assistantMessage"],
    answer: result.answer.trim(),
    truncated: result.truncated,
  };
}

export async function loadKiraiConversations(): Promise<KiraiConversation[]> {
  const result = await apiClient.request<unknown>("/kirai/conversations", { authenticated: true });
  if (!isRecord(result) || !Array.isArray(result.conversations)) throw new Error("KIRAI conversation response is invalid.");
  return result.conversations.filter((row): row is KiraiConversation => isRecord(row) &&
    typeof row.id === "string" && typeof row.title === "string" && typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string" && typeof row.lastMessageAt === "string");
}

export async function loadKiraiMessagePage(conversationId: string, offset: number, limit = 100): Promise<{ messages: KiraiMessage[]; hasMore: boolean }> {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  const result = await apiClient.request<unknown>(`/kirai/conversations/${encodeURIComponent(conversationId)}/messages?${query}`, { authenticated: true });
  if (!isRecord(result) || !Array.isArray(result.messages) || typeof result.hasMore !== "boolean") throw new Error("KIRAI message response is invalid.");
  const messages = result.messages.filter((row): row is KiraiMessage => isRecord(row) &&
    typeof row.id === "string" && typeof row.conversationId === "string" &&
    (row.role === "user" || row.role === "assistant") && typeof row.content === "string" &&
    typeof row.createdAt === "string");
  return { messages, hasMore: result.hasMore };
}

export async function checkKiraiAvailability(): Promise<KiraiAvailability> {
  const result = await apiClient.request<unknown>("/kirai/availability", {
    authenticated: true,
  });
  if (!isRecord(result) || result.available !== true) {
    throw new Error("The KIRAI availability response is invalid.");
  }
  return { available: true };
}
