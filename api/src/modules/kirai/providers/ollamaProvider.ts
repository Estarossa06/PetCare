import type { KiraiOllamaConfig } from "../../../config/kiraiOllama.js";
import type { ModelRequest, ModelResponse } from "../types/agent.js";
import type {
  ModelGenerationOptions,
  ModelProvider,
} from "./model-provider.js";

type OllamaChatResponse = {
  message?: {
    role?: unknown;
    content?: unknown;
  };
  done_reason?: unknown;
};

export type OllamaProviderErrorCode =
  | "invalid_request"
  | "timeout"
  | "cancelled"
  | "connection"
  | "http"
  | "invalid_response";

export class OllamaProviderError extends Error {
  constructor(
    readonly code: OllamaProviderErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OllamaProviderError";
  }
}

type Fetcher = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): ModelResponse {
  if (!isRecord(value) || !isRecord(value.message)) {
    throw new OllamaProviderError(
      "invalid_response",
      "Ollama returned an invalid chat response.",
    );
  }

  const content = value.message.content;
  if (value.message.role !== "assistant" || typeof content !== "string" || !content.trim()) {
    throw new OllamaProviderError(
      "invalid_response",
      "Ollama returned an invalid final assistant message.",
    );
  }

  const finishReason =
    value.done_reason === "stop"
      ? "stop"
      : value.done_reason === "length"
        ? "length"
        : "other";

  return {
    message: { role: "assistant", content },
    finishReason,
  };
}

export class OllamaProvider implements ModelProvider {
  constructor(
    private readonly config: KiraiOllamaConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async generate(
    request: ModelRequest,
    options: ModelGenerationOptions = {},
  ): Promise<ModelResponse> {
    if (request.messages.length === 0) {
      throw new OllamaProviderError(
        "invalid_request",
        "At least one chat message is required.",
      );
    }

    if (options.signal?.aborted) {
      throw new OllamaProviderError("cancelled", "Ollama request was cancelled.");
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    const abortRequest = (): void => controller.abort();
    options.signal?.addEventListener("abort", abortRequest, { once: true });

    try {
      const response = await this.fetcher(`${this.config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages,
          stream: false,
          ...(request.temperature === undefined || request.maxOutputTokens === undefined
            ? {
                options: {
                  ...(request.temperature === undefined
                    ? {}
                    : { temperature: request.temperature }),
                  ...(request.maxOutputTokens === undefined
                    ? {}
                    : { num_predict: request.maxOutputTokens }),
                },
              }
            : {
                options: {
                  temperature: request.temperature,
                  num_predict: request.maxOutputTokens,
                },
              }),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OllamaProviderError(
          "http",
          `Ollama request failed with HTTP ${response.status}.`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (timedOut || options.signal?.aborted) throw error;
        throw new OllamaProviderError(
          "invalid_response",
          "Ollama returned invalid JSON.",
        );
      }
      return parseResponse(payload);
    } catch (error) {
      if (error instanceof OllamaProviderError) throw error;
      if (timedOut) {
        throw new OllamaProviderError("timeout", "Ollama request timed out.");
      }
      if (options.signal?.aborted) {
        throw new OllamaProviderError("cancelled", "Ollama request was cancelled.");
      }
      throw new OllamaProviderError(
        "connection",
        "Could not connect to the local Ollama service.",
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortRequest);
    }
  }
}
