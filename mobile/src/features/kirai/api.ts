import { apiClient } from "../auth/apiClient";
import type { KiraiHistoryMessage } from "./conversation";

export interface KiraiChatResult {
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
  message: string,
  history: readonly KiraiHistoryMessage[],
): Promise<KiraiChatResult> {
  const result = await apiClient.request<unknown>("/kirai/chat", {
    method: "POST",
    body: {
      message,
      history: history.map(({ role, content }) => ({ role, content })),
    },
    authenticated: true,
  });
  if (
    !isRecord(result) ||
    typeof result.answer !== "string" ||
    !result.answer.trim() ||
    typeof result.truncated !== "boolean"
  ) {
    throw new Error("The KIRAI response is invalid.");
  }
  return {
    answer: result.answer.trim(),
    truncated: result.truncated,
  };
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
