import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { loadConfig } from "../src/config/env.js";
import { createErrorHandler } from "../src/middleware/errors.js";
import { requestIdMiddleware } from "../src/middleware/requestId.js";
import { createApp } from "../src/app.js";
import { startServer } from "../src/server.js";
import type { Logger, LogFields } from "../src/observability/logger.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

const defaultEnvironment = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/petcare_test",
  AUTH_ACCESS_TOKEN_SECRET: "test-secret-value-that-is-at-least-32-bytes",
};

function createTestLogger(): { logger: Logger; entries: LogFields[] } {
  const entries: LogFields[] = [];
  return {
    entries,
    logger: {
      info: (fields) => entries.push(fields),
      error: (fields) => entries.push(fields),
    },
  };
}

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

async function close(server: Server): Promise<void> {
  const closed = once(server, "close");
  server.close();
  await closed;
}

test("configuration requires a PostgreSQL URL and validates port and CORS origins", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "test" }),
    /DATABASE_URL is required/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...defaultEnvironment,
        AUTH_ACCESS_TOKEN_SECRET: "too-short",
      }),
    /at least 32 bytes/,
  );
  assert.throws(
    () => loadConfig({ ...defaultEnvironment, DATABASE_URL: "https://example.com/db" }),
    /valid PostgreSQL connection URL/,
  );
  assert.throws(
    () => loadConfig({ ...defaultEnvironment, PORT: "70000" }),
    /PORT must be an integer/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...defaultEnvironment,
        CORS_ORIGINS: "https://example.com/path",
      }),
    /CORS_ORIGINS/,
  );

  const config = loadConfig({
    ...defaultEnvironment,
    CORS_ORIGINS: "https://example.com,http://localhost:8081",
  });
  assert.deepEqual(config.corsOrigins, [
    "https://example.com",
    "http://localhost:8081",
  ]);
});

test("application starts and returns health with a generated request ID", async () => {
  const { logger, entries } = createTestLogger();
  const app = createApp({
    config: {
      corsOrigins: [],
      accessTokenSecret: Buffer.from(defaultEnvironment.AUTH_ACCESS_TOKEN_SECRET),
    },
    database: { query: async () => ({}) },
    authStore: new MemoryAuthStore(),
    logger,
  });
  const running = await listen(app);
  try {
    const response = await fetch(`${running.baseUrl}/health?token=private`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    const requestId = response.headers.get("x-request-id");
    assert.match(requestId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, "/health");
    assert.equal(JSON.stringify(entries).includes("private"), false);
  } finally {
    await close(running.server);
  }
});

test("HTTP server starts without running migrations and closes cleanly", async () => {
  const config = {
    ...loadConfig(defaultEnvironment),
    port: 0,
  };
  const running = await startServer(config);
  try {
    const address = running.server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    await running.close();
  }
});

test("readiness checks the database and returns only generic failure details", async () => {
  const { logger, entries } = createTestLogger();
  let query: string | undefined;
  const readyApp = createApp({
    config: {
      corsOrigins: [],
      accessTokenSecret: Buffer.from(defaultEnvironment.AUTH_ACCESS_TOKEN_SECRET),
    },
    database: {
      query: async (text) => {
        query = text;
        return {};
      },
    },
    authStore: new MemoryAuthStore(),
    logger,
  });
  const readyServer = await listen(readyApp);
  try {
    const response = await fetch(`${readyServer.baseUrl}/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ready",
      dependencies: { database: "available" },
    });
    assert.equal(query, "SELECT 1");
  } finally {
    await close(readyServer.server);
  }

  const failingApp = createApp({
    config: {
      corsOrigins: [],
      accessTokenSecret: Buffer.from(defaultEnvironment.AUTH_ACCESS_TOKEN_SECRET),
    },
    database: { query: async () => Promise.reject(new Error("private connection detail")) },
    authStore: new MemoryAuthStore(),
    logger,
  });
  const failingServer = await listen(failingApp);
  try {
    const response = await fetch(`${failingServer.baseUrl}/ready`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /"database":"unavailable"/);
    assert.equal(body.includes("private connection detail"), false);
    assert.ok(entries.some((entry) => entry.event === "readiness_check_failed"));
  } finally {
    await close(failingServer.server);
  }
});

test("errors are sanitized and requests receive a request ID", async () => {
  const { logger } = createTestLogger();
  const app = express();
  app.use(requestIdMiddleware);
  app.get("/failure", (_request, _response, next) => {
    next(new Error("database password must not be exposed"));
  });
  app.use(createErrorHandler(logger));
  const running = await listen(app);
  try {
    const response = await fetch(`${running.baseUrl}/failure`);
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /"code":"INTERNAL_ERROR"/);
    assert.equal(body.includes("database password"), false);
    assert.ok(response.headers.get("x-request-id"));
  } finally {
    await close(running.server);
  }
});

test("HTTP errors cover unknown routes, malformed JSON, unsupported content types and large bodies", async () => {
  const { logger } = createTestLogger();
  const app = createApp({
    config: {
      corsOrigins: [],
      accessTokenSecret: Buffer.from(defaultEnvironment.AUTH_ACCESS_TOKEN_SECRET),
    },
    database: { query: async () => ({}) },
    authStore: new MemoryAuthStore(),
    logger,
  });
  const running = await listen(app);
  try {
    const notFound = await fetch(`${running.baseUrl}/missing`);
    assert.equal(notFound.status, 404);
    assert.match(await notFound.text(), /"code":"NOT_FOUND"/);

    const malformed = await fetch(`${running.baseUrl}/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.match(await malformed.text(), /"code":"INVALID_JSON"/);

    const unsupported = await fetch(`${running.baseUrl}/health`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "payload",
    });
    assert.equal(unsupported.status, 415);

    const tooLarge = await fetch(`${running.baseUrl}/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(1_048_600) }),
    });
    assert.equal(tooLarge.status, 413);
    assert.match(await tooLarge.text(), /"code":"BODY_TOO_LARGE"/);
  } finally {
    await close(running.server);
  }
});

test("CORS allows configured origins and rejects disallowed preflights", async () => {
  const { logger } = createTestLogger();
  const app = createApp({
    config: {
      corsOrigins: ["https://petcare.example"],
      accessTokenSecret: Buffer.from(defaultEnvironment.AUTH_ACCESS_TOKEN_SECRET),
    },
    database: { query: async () => ({}) },
    authStore: new MemoryAuthStore(),
    logger,
  });
  const running = await listen(app);
  try {
    const allowed = await fetch(`${running.baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://petcare.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://petcare.example",
    );

    const noOrigin = await fetch(`${running.baseUrl}/health`, {
      method: "OPTIONS",
    });
    assert.equal(noOrigin.status, 200);

    const denied = await fetch(`${running.baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  } finally {
    await close(running.server);
  }
});
