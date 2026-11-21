import type { ModelRequest, ModelResponse } from "../types/agent.js";

export interface ModelGenerationOptions {
  signal?: AbortSignal;
}

export interface ModelProvider {
  checkAvailability(): Promise<void>;
  generate(
    request: ModelRequest,
    options?: ModelGenerationOptions,
  ): Promise<ModelResponse>;
}
