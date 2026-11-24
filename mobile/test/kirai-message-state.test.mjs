import assert from "node:assert/strict";
import { test } from "node:test";
import { kiraiDeliveryLabel, mergeKiraiMessagePage } from "../src/features/kirai/messageState.ts";
import { deliverKiraiQuestion } from "../src/features/kirai/delivery.ts";

const question = (id, requestId, requestStatus = "pending", createdAt = "2026-11-23T12:00:00.000Z") => ({
  id, conversationId: "conversation-1", role: "user", content: "¿Qué sabes de Mora?", createdAt,
  requestId, replyToMessageId: null, requestStatus, truncated: false,
});

test("offline saved message remains visible and retryable after server history loads", () => {
  const saved = question("request-1", "request-1");
  const merged = mergeKiraiMessagePage([], [saved]);

  assert.equal(merged.length, 1);
  assert.equal(kiraiDeliveryLabel(merged[0], null), "Pendiente");
});

test("retry keeps one local message and an acknowledged server message replaces its pending state", () => {
  const saved = question("request-1", "request-1");
  const server = { ...question("request-1", "request-1", "complete"), createdAt: "2026-11-23T12:00:01.000Z" };

  assert.equal(mergeKiraiMessagePage([], [saved, saved]).length, 1);
  const merged = mergeKiraiMessagePage([server], [saved]);
  assert.equal(merged.length, 1);
  assert.equal(kiraiDeliveryLabel(merged[0], null), "Enviado");
});

test("sending and failed states are distinct; only failed messages show a failure state", () => {
  const pending = question("request-1", "request-1");
  assert.equal(kiraiDeliveryLabel(pending, "request-1"), "Enviando…");
  assert.equal(kiraiDeliveryLabel({ ...pending, requestStatus: "failed" }, null), "No se envió");
  assert.equal(kiraiDeliveryLabel({ ...pending, requestStatus: "complete" }, null), "Enviado");
});

test("offline failure stays in the outbox and reconnect retry reuses the request ID without duplicates", async () => {
  const outbox = new Map();
  const attempts = [];
  let unavailable = true;
  const common = {
    authUserId: "user-a", conversationId: "conversation-1", requestId: "stable-request-id", content: "¿Qué sabes de Mora?",
    savePending: async (owner, conversationId, requestId, content) => {
      const current = outbox.get(requestId);
      const saved = current
        ? { ...current, requestStatus: "pending" }
        : { ...question(requestId, requestId), conversationId, content };
      outbox.set(requestId, saved);
      return saved;
    },
    onSaved: () => {},
    readLocalContext: async () => ({ pets: [] }),
    ask: async (input) => {
      attempts.push(input.requestId);
      if (unavailable) throw new Error("network unavailable");
      return {
        userMessage: { id: input.requestId, createdAt: "2026-11-23T12:00:01.000Z", content: input.message },
        assistantMessage: { id: "answer-1", createdAt: "2026-11-23T12:00:02.000Z", content: "Respuesta confirmada", truncated: false },
      };
    },
    complete: async (_owner, _conversation, requestId) => outbox.set(requestId, { ...outbox.get(requestId), requestStatus: "complete" }),
    fail: async (_owner, requestId) => outbox.set(requestId, { ...outbox.get(requestId), requestStatus: "failed" }),
  };

  await assert.rejects(deliverKiraiQuestion(common), /network unavailable/);
  assert.equal(outbox.size, 1);
  assert.equal(outbox.get("stable-request-id").requestStatus, "failed");
  unavailable = false;
  await deliverKiraiQuestion(common);

  assert.deepEqual(attempts, ["stable-request-id", "stable-request-id"]);
  assert.equal(outbox.size, 1);
  assert.equal(outbox.get("stable-request-id").requestStatus, "complete");
});
