import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KIRAI_OLLAMA_BASE_URL,
  DEFAULT_KIRAI_OLLAMA_MODEL,
  loadKiraiOllamaConfig,
} from "../src/config/kiraiOllama.js";
import { buildSystemMessage } from "../src/modules/kirai/prompts/system.js";
import type { ModelMessage } from "../src/modules/kirai/types/agent.js";
import type { ModelProvider } from "../src/modules/kirai/providers/model-provider.js";
import {
  OllamaProvider,
  OllamaProviderError,
} from "../src/modules/kirai/providers/ollamaProvider.js";

const config = {
  baseUrl: DEFAULT_KIRAI_OLLAMA_BASE_URL,
  model: DEFAULT_KIRAI_OLLAMA_MODEL,
  timeoutMs: 100,
};

function createProvider(fetcher: typeof fetch): ModelProvider {
  return new OllamaProvider(config, fetcher);
}

const messages: ModelMessage[] = [
  buildSystemMessage(),
  { role: "user", content: "¿Por qué necesita agua limpia un perro?" },
];

test("Ollama config defaults locally and rejects non-loopback hosts", () => {
  assert.deepEqual(loadKiraiOllamaConfig({}), {
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:8b",
    timeoutMs: 60_000,
  });
  assert.throws(
    () => loadKiraiOllamaConfig({ KIRAI_OLLAMA_BASE_URL: "http://ollama.example.com" }),
    /loopback host only/,
  );
  assert.throws(
    () => loadKiraiOllamaConfig({ KIRAI_OLLAMA_TIMEOUT_MS: "0" }),
    /between 1 and 300000/,
  );
});

test("sends the system message to /api/chat and returns only final content", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const provider = createProvider(async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      message: {
        role: "assistant",
        content: "El agua limpia ayuda a mantener una buena hidratación.",
        thinking: "This private reasoning must not leave the adapter.",
      },
      done_reason: "stop",
    });
  });

  const response = await provider.generate({ messages, temperature: 0.2, maxOutputTokens: 64 });

  assert.equal(requestUrl, "http://127.0.0.1:11434/api/chat");
  assert.equal(requestBody?.model, "qwen3:8b");
  assert.equal(requestBody?.stream, false);
  assert.deepEqual(requestBody?.messages, messages);
  assert.deepEqual(response, {
    message: {
      role: "assistant",
      content: "El agua limpia ayuda a mantener una buena hidratación.",
    },
    finishReason: "stop",
  });
  assert.equal(JSON.stringify(response).includes("thinking"), false);
});

test("reports HTTP status without exposing the response body", async () => {
  const provider = createProvider(async () =>
    new Response("sensitive model output", { status: 500 }),
  );

  await assert.rejects(
    provider.generate({ messages }),
    (error: unknown) =>
      error instanceof OllamaProviderError &&
      error.code === "http" &&
      error.status === 500 &&
      !error.message.includes("sensitive"),
  );
});

test("reports connection failures without exposing low-level details", async () => {
  const provider = createProvider(async () => {
    throw new Error("private connection detail");
  });

  await assert.rejects(
    provider.generate({ messages }),
    (error: unknown) =>
      error instanceof OllamaProviderError &&
      error.code === "connection" &&
      !error.message.includes("private"),
  );
});

test("times out and supports caller cancellation", async () => {
  const hangingFetcher: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  const provider = new OllamaProvider({ ...config, timeoutMs: 10 }, hangingFetcher);

  await assert.rejects(
    provider.generate({ messages }),
    (error: unknown) =>
      error instanceof OllamaProviderError && error.code === "timeout",
  );

  const controller = new AbortController();
  const pending = provider.generate({ messages }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof OllamaProviderError && error.code === "cancelled",
  );
});

test("rejects malformed, invalid JSON, and empty final responses", async () => {
  const provider = createProvider(async () => Response.json({ message: { thinking: "hidden" } }));
  await assert.rejects(
    provider.generate({ messages }),
    (error: unknown) =>
      error instanceof OllamaProviderError && error.code === "invalid_response",
  );

  const invalidJsonProvider = createProvider(async () =>
    new Response("{", { headers: { "Content-Type": "application/json" } }),
  );
  await assert.rejects(
    invalidJsonProvider.generate({ messages }),
    (error: unknown) =>
      error instanceof OllamaProviderError && error.code === "invalid_response",
  );

  const emptyContentProvider = createProvider(async () =>
    Response.json({ message: { role: "assistant", content: "  " } }),
  );
  await assert.rejects(
    emptyContentProvider.generate({ messages }),
    (error: unknown) =>
      error instanceof OllamaProviderError && error.code === "invalid_response",
  );
});
