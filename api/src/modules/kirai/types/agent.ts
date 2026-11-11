export interface AgentIdentity {
  readonly name: string;
  readonly defaultLanguage: string;
  readonly personality: readonly string[];
  readonly communicationStyle: readonly string[];
  readonly specialization: string;
  readonly topics: readonly string[];
}

export type ModelMessageRole = "system" | "user" | "assistant";

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface ModelRequest {
  messages: readonly ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export type ModelFinishReason = "stop" | "length" | "other";

export interface ModelResponse {
  message: ModelMessage;
  finishReason?: ModelFinishReason;
}
