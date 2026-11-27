import { buildSystemMessage } from "./prompts/system.js";
import type { ModelProvider } from "./providers/model-provider.js";
import type { KiraiHistoryMessage } from "./validation.js";

export interface KiraiAnswer {
  answer: string;
  truncated: boolean;
}

export class KiraiConversationService {
  constructor(private readonly provider: ModelProvider) {}

  async answer(
    message: string,
    history: readonly KiraiHistoryMessage[] = [],
    petContext = "",
  ): Promise<KiraiAnswer> {
    const messages = [buildSystemMessage()];
    if (petContext) messages.push({ role: "system", content: petContext });
    messages.push(...history, { role: "user", content: message });
    const response = await this.provider.generate({
      messages,
      temperature: 0.3,
      maxOutputTokens: 512,
    });
    const answer = response.message.content.trim();
    if (response.message.role !== "assistant" || !answer) {
      throw new Error("KIRAI returned an invalid answer.");
    }
    return {
      answer,
      truncated: response.finishReason === "length",
    };
  }
}
