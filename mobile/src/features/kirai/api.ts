import { apiClient } from "../auth/apiClient";

export interface KiraiChatResult {
  answer: string;
  truncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function askKirai(message: string): Promise<KiraiChatResult> {
  const result = await apiClient.request<unknown>("/kirai/chat", {
    method: "POST",
    body: { message },
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
