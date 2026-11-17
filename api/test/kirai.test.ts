import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app.js";
import {
  DEFAULT_KIRAI_OLLAMA_BASE_URL,
  DEFAULT_KIRAI_OLLAMA_MODEL,
  loadKiraiOllamaConfig,
} from "../src/modules/kirai/config.js";
import { buildSystemMessage } from "../src/modules/kirai/prompts/system.js";
import type { ModelMessage, ModelRequest } from "../src/modules/kirai/types/agent.js";
import type { ModelProvider } from "../src/modules/kirai/providers/model-provider.js";
import {
  OllamaProvider,
  OllamaProviderError,
} from "../src/modules/kirai/providers/ollamaProvider.js";
import type { Logger, LogFields } from "../src/observability/logger.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

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
  assert.equal(requestBody?.think, false);
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

const routeSecret = Buffer.from("kirai-route-test-secret-at-least-32-bytes");

async function listen(app: express.Express): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function createKiraiHarness(provider: ModelProvider) {
  const entries: LogFields[] = [];
  const logger: Logger = {
    info: (fields) => entries.push(fields),
    error: (fields) => entries.push(fields),
  };
  const app = createApp({
    config: { corsOrigins: [], accessTokenSecret: routeSecret },
    database: { query: async () => ({ rows: [] }) },
    authStore: new MemoryAuthStore(),
    logger,
    kiraiProvider: provider,
  });
  const running = await listen(app);

  return {
    ...running,
    entries,
    async register(): Promise<string> {
      const response = await fetch(`${running.baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "kirai-test@example.com",
          password: "correct horse battery staple",
          name: "KIRAI Test",
        }),
      });
      assert.equal(response.status, 201);
      const result = (await response.json()) as { accessToken: string };
      return result.accessToken;
    },
    async chat(body: unknown, accessToken?: string): Promise<Response> {
      return fetch(`${running.baseUrl}/kirai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
    },
  };
}

test("KIRAI chat requires an active authenticated session", async () => {
  let calls = 0;
  const harness = await createKiraiHarness({
    async generate() {
      calls += 1;
      return { message: { role: "assistant", content: "respuesta" } };
    },
  });
  try {
    const response = await harness.chat({ message: "Pregunta" });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  } finally {
    const closed = once(harness.server, "close");
    harness.server.close();
    await closed;
  }
});

test("KIRAI chat sends only one trimmed question with the existing safety prompt", async () => {
  let received: ModelRequest | undefined;
  const question = "¿Cómo ayudo a mi perro a adaptarse a una rutina?";
  const harness = await createKiraiHarness({
    async generate(request) {
      received = request;
      return {
        message: { role: "assistant", content: "  Mantén horarios consistentes.  " },
        finishReason: "length",
      };
    },
  });
  try {
    const accessToken = await harness.register();
    const response = await harness.chat(
      { message: `  ${question}  `, petRecords: "must not be forwarded" },
      accessToken,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      answer: "Mantén horarios consistentes.",
      truncated: true,
    });
    assert.equal(received?.messages.length, 2);
    assert.equal(received?.messages[0].role, "system");
    assert.match(received?.messages[0].content ?? "", /No prescribas medicamentos/);
    assert.deepEqual(received?.messages[1], { role: "user", content: question });
    assert.equal(JSON.stringify(harness.entries).includes(question), false);
    assert.equal(JSON.stringify(received).includes("must not be forwarded"), false);
  } finally {
    const closed = once(harness.server, "close");
    harness.server.close();
    await closed;
  }
});

test("KIRAI chat validates non-empty bounded messages before calling the model", async () => {
  let calls = 0;
  const harness = await createKiraiHarness({
    async generate() {
      calls += 1;
      return { message: { role: "assistant", content: "respuesta" } };
    },
  });
  try {
    const accessToken = await harness.register();
    for (const body of [
      {},
      { message: "  " },
      { message: "x".repeat(2_001) },
      { message: 42 },
    ]) {
      const response = await harness.chat(body, accessToken);
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.error.code, "VALIDATION_ERROR");
    }
    assert.equal(calls, 0);
  } finally {
    const closed = once(harness.server, "close");
    harness.server.close();
    await closed;
  }
});

test("KIRAI chat sanitizes provider failures", async () => {
  const privateDetail = "private Ollama response detail";
  const harness = await createKiraiHarness({
    async generate() {
      throw new OllamaProviderError("timeout", privateDetail);
    },
  });
  try {
    const accessToken = await harness.register();
    const response = await harness.chat(
      { message: "Pregunta sin datos privados" },
      accessToken,
    );
    assert.equal(response.status, 503);
    const result = await response.text();
    assert.match(result, /KIRAI_UNAVAILABLE/);
    assert.equal(result.includes(privateDetail), false);
    assert.equal(JSON.stringify(harness.entries).includes(privateDetail), false);
  } finally {
    const closed = once(harness.server, "close");
    harness.server.close();
    await closed;
  }
});

test("KIRAI chat rate-limits authenticated generation requests", async () => {
  let calls = 0;
  const harness = await createKiraiHarness({
    async generate() {
      calls += 1;
      return { message: { role: "assistant", content: "respuesta" } };
    },
  });
  try {
    const accessToken = await harness.register();
    for (let index = 0; index < 11; index += 1) {
      const response = await harness.chat(
        { message: `Pregunta ${index}` },
        accessToken,
      );
      assert.equal(response.status, index < 10 ? 200 : 429);
    }
    assert.equal(calls, 10);
  } finally {
    const closed = once(harness.server, "close");
    harness.server.close();
    await closed;
  }
});
