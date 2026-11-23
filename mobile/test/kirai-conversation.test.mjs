import assert from "node:assert/strict";
import test from "node:test";
import {
  kiraiConversationReducer,
  kiraiHistoryForRequest,
  trimKiraiConversation,
} from "../src/features/kirai/conversation.ts";

test("keeps only the five most recent complete turns", () => {
  const messages = [];
  for (let index = 1; index <= 6; index += 1) {
    messages.push(
      { role: "user", content: `pregunta-${index}` },
      { role: "assistant", content: `respuesta-${index}` },
    );
  }

  const trimmed = trimKiraiConversation(messages);

  assert.equal(trimmed.length, 10);
  assert.equal(trimmed[0].content, "pregunta-2");
  assert.equal(trimmed[9].content, "respuesta-6");
});

test("caps retained conversation characters without splitting turns", () => {
  let conversation = [];
  for (let index = 1; index <= 3; index += 1) {
    conversation = kiraiConversationReducer(conversation, {
      type: "add-turn",
      question: `Q${index}${"x".repeat(1_998)}`,
      answer: `A${index}${"y".repeat(1_998)}`,
      truncated: false,
    });
  }

  assert.equal(conversation.length, 4);
  assert.equal(
    conversation.reduce((total, message) => total + message.content.length, 0),
    8_000,
  );
  assert.ok(conversation[0].content.startsWith("Q2"));
});

test("clears the in-memory conversation and request context", () => {
  const conversation = kiraiConversationReducer([], {
    type: "add-turn",
    question: "¿Qué necesita mi perro?",
    answer: "Agua limpia y atención diaria.",
    truncated: true,
  });
  const newConversation = kiraiConversationReducer(conversation, {
    type: "clear",
  });

  assert.deepEqual(newConversation, []);
  assert.deepEqual(kiraiHistoryForRequest(newConversation), []);
});

test("sends completed turns in order without UI-only truncation metadata", () => {
  const conversation = kiraiConversationReducer([], {
    type: "add-turn",
    question: "Pregunta anterior",
    answer: "Respuesta anterior",
    truncated: true,
  });

  assert.deepEqual(kiraiHistoryForRequest(conversation), [
    { role: "user", content: "Pregunta anterior" },
    { role: "assistant", content: "Respuesta anterior" },
  ]);
});
