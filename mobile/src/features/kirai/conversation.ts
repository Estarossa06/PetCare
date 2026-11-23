export const MAX_KIRAI_CONTEXT_MESSAGES = 10;
export const MAX_KIRAI_CONTEXT_CHARACTERS = 8_000;

export type KiraiMessageRole = "user" | "assistant";

export interface KiraiConversationMessage {
  role: KiraiMessageRole;
  content: string;
  truncated?: boolean;
}

export interface KiraiHistoryMessage {
  role: KiraiMessageRole;
  content: string;
}

export type KiraiConversationAction =
  | {
      type: "add-turn";
      question: string;
      answer: string;
      truncated: boolean;
    }
  | { type: "clear" };

export function trimKiraiConversation(
  messages: readonly KiraiConversationMessage[],
): KiraiConversationMessage[] {
  const completeLength = messages.length - (messages.length % 2);
  const recent: KiraiConversationMessage[] = [];
  let totalCharacters = 0;

  for (let index = completeLength - 2; index >= 0; index -= 2) {
    const userMessage = messages[index];
    const assistantMessage = messages[index + 1];
    if (
      userMessage.role !== "user" ||
      assistantMessage.role !== "assistant"
    ) {
      break;
    }

    const pairCharacters =
      userMessage.content.length + assistantMessage.content.length;
    if (
      recent.length + 2 > MAX_KIRAI_CONTEXT_MESSAGES ||
      totalCharacters + pairCharacters > MAX_KIRAI_CONTEXT_CHARACTERS
    ) {
      break;
    }

    recent.unshift(userMessage, assistantMessage);
    totalCharacters += pairCharacters;
  }

  return recent;
}

export function kiraiConversationReducer(
  messages: readonly KiraiConversationMessage[],
  action: KiraiConversationAction,
): KiraiConversationMessage[] {
  if (action.type === "clear") return [];

  return trimKiraiConversation([
    ...messages,
    { role: "user", content: action.question },
    {
      role: "assistant",
      content: action.answer,
      ...(action.truncated ? { truncated: true } : {}),
    },
  ]);
}

export function kiraiHistoryForRequest(
  messages: readonly KiraiConversationMessage[],
): KiraiHistoryMessage[] {
  return trimKiraiConversation(messages).map(({ role, content }) => ({
    role,
    content,
  }));
}
