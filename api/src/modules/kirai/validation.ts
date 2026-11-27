import { validateLocalPetContext, type KiraiLocalContext } from "./petContext.js";

export const MAX_KIRAI_MESSAGE_LENGTH = 2_000;
export const MAX_KIRAI_HISTORY_MESSAGES = 10;
export const MAX_KIRAI_HISTORY_CHARACTERS = 8_000;

export interface KiraiHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface KiraiChatRequest {
  message: string;
  history: KiraiHistoryMessage[];
  conversationId?: string;
  requestId?: string;
  localContext: KiraiLocalContext;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidKiraiRequestError extends Error {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";

  constructor() {
    super("KIRAI message or conversation history is invalid.");
    this.name = "InvalidKiraiRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateHistory(value: unknown): KiraiHistoryMessage[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_KIRAI_HISTORY_MESSAGES ||
    value.length % 2 !== 0
  ) {
    throw new InvalidKiraiRequestError();
  }

  let totalCharacters = 0;
  return value.map((entry, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    if (
      !isRecord(entry) ||
      entry.role !== role ||
      typeof entry.content !== "string"
    ) {
      throw new InvalidKiraiRequestError();
    }

    const content = entry.content.trim();
    totalCharacters += content.length;
    const maxMessageLength =
      role === "user" ? MAX_KIRAI_MESSAGE_LENGTH : MAX_KIRAI_HISTORY_CHARACTERS;
    if (
      !content ||
      content.length > maxMessageLength ||
      totalCharacters > MAX_KIRAI_HISTORY_CHARACTERS
    ) {
      throw new InvalidKiraiRequestError();
    }

    return { role, content };
  });
}

export function validateKiraiRequest(body: unknown): KiraiChatRequest {
  if (!isRecord(body) || typeof body.message !== "string") {
    throw new InvalidKiraiRequestError();
  }

  const message = body.message.trim();
  if (!message || message.length > MAX_KIRAI_MESSAGE_LENGTH) {
    throw new InvalidKiraiRequestError();
  }
  const conversationId = body.conversationId;
  const requestId = body.requestId;
  if ((conversationId !== undefined && (typeof conversationId !== "string" || !UUID.test(conversationId))) ||
      (requestId !== undefined && (typeof requestId !== "string" || !UUID.test(requestId)))) {
    throw new InvalidKiraiRequestError();
  }
  let localContext: KiraiLocalContext;
  try {
    localContext = validateLocalPetContext(body.localContext);
  } catch {
    throw new InvalidKiraiRequestError();
  }
  return {
    message,
    history: validateHistory(body.history),
    ...(typeof conversationId === "string" ? { conversationId: conversationId.toLowerCase() } : {}),
    ...(typeof requestId === "string" ? { requestId: requestId.toLowerCase() } : {}),
    localContext,
  };
}
