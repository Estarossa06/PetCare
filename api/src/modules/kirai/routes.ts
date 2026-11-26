import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import type { Queryable } from "../../db/queryable.js";
import { requirePrincipal } from "../auth/middleware/authenticate.js";
import { createAuthenticateMiddleware } from "../auth/middleware/authenticate.js";
import type { AuthStore } from "../auth/types.js";
import type { Logger } from "../../observability/logger.js";
import { OllamaProviderError } from "./providers/ollamaProvider.js";
import type { ModelProvider } from "./providers/model-provider.js";
import { KiraiConversationService } from "./service.js";
import { validateKiraiRequest } from "./validation.js";
import { buildPetContextText, loadRemotePetContext } from "./petContext.js";
import { KiraiIdempotencyConflictError, KiraiNotFoundError, PostgresKiraiStore, type KiraiStore } from "./repository.js";

type KiraiAvailabilityErrorCode =
  | "KIRAI_CONNECTION_ERROR"
  | "KIRAI_UNAVAILABLE";

function createKiraiRateLimit(logger: Logger): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request, response) => {
      const requestId = String(response.getHeader("X-Request-Id") ?? "");
      logger.info({
        event: "kirai_rate_limit_exceeded",
        requestId,
        path: request.path,
      });
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many KIRAI requests. Try again later.",
          requestId,
        },
      });
    },
  });
}

function availabilityErrorCode(error: unknown): KiraiAvailabilityErrorCode {
  if (
    error instanceof OllamaProviderError &&
    (error.code === "connection" || error.code === "timeout")
  ) {
    return "KIRAI_CONNECTION_ERROR";
  }
  return "KIRAI_UNAVAILABLE";
}

export function createKiraiRouter(
  provider: ModelProvider,
  authStore: AuthStore,
  accessTokenSecret: Uint8Array,
  logger: Logger,
  database: Queryable,
  store: KiraiStore = new PostgresKiraiStore(database),
): Router {
  const router = Router();
  const service = new KiraiConversationService(provider);
  const authenticate = createAuthenticateMiddleware(authStore, accessTokenSecret);

  router.get("/availability", authenticate, async (_request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      await provider.checkAvailability();
      response.status(200).json({ available: true });
    } catch (error) {
      const code = availabilityErrorCode(error);
      logger.error({
        event: "kirai_availability_check_failed",
        requestId: String(response.getHeader("X-Request-Id") ?? ""),
        code:
          error instanceof OllamaProviderError ? error.code : "unexpected",
      });
      response.status(503).json({
        error: {
          code,
          message:
            code === "KIRAI_CONNECTION_ERROR"
              ? "KIRAI could not connect to its model provider."
              : "KIRAI or its configured model is unavailable.",
          requestId: String(response.getHeader("X-Request-Id") ?? ""),
        },
      });
    }
  });

  router.post(
    "/chat",
    authenticate,
    createKiraiRateLimit(logger),
    async (request, response, next) => {
      let chatRequest: ReturnType<typeof validateKiraiRequest>;
      try {
        chatRequest = validateKiraiRequest(request.body);
      } catch (error) {
        next(error);
        return;
      }

      const principal = requirePrincipal(request);
      const conversationId = chatRequest.conversationId ?? randomUUID();
      const requestId = chatRequest.requestId ?? randomUUID();
      let generationStage: "load_context" | "generate_answer" | "persist_answer" = "load_context";
      let prepared: Awaited<ReturnType<KiraiStore["prepareRequest"]>>;
      try {
        prepared = await store.prepareRequest({
          ownerId: principal.userId,
          conversationId,
          requestId,
          message: chatRequest.message,
        });
      } catch (error) {
        if (error instanceof KiraiIdempotencyConflictError) {
          response.status(409).json({ error: { code: error.code, message: "This message ID was already used for a different request." } });
          return;
        }
        if (error instanceof KiraiNotFoundError) {
          response.status(404).json({ error: { code: error.code, message: "Conversation not found." } });
          return;
        }
        logger.error({ event: "kirai_request_persistence_failed", requestId: String(response.getHeader("X-Request-Id") ?? "") });
        response.status(503).json({ error: { code: "KIRAI_UNAVAILABLE", message: "KIRAI is temporarily unavailable." } });
        return;
      }
      if (prepared.answer) {
        response.status(200).json(chatResult(prepared.conversationId, prepared.message, prepared.answer));
        return;
      }

      try {
        const [remoteContext, history] = await Promise.all([
          loadRemotePetContext(database, principal.userId),
          store.conversationHistory(principal.userId, prepared.conversationId, prepared.message),
        ]);
        const contextText = buildPetContextText(remoteContext, chatRequest.localContext);
        generationStage = "generate_answer";
        const result = await service.answer(prepared.message.content, history, contextText);
        generationStage = "persist_answer";
        const answer = await store.saveAnswer(principal.userId, prepared.message, result.answer, result.truncated);
        response.status(200).json(chatResult(prepared.conversationId, prepared.message, answer));
      } catch (error) {
        await store.markFailed(principal.userId, prepared.message.id).catch(() => undefined);
        const code = availabilityErrorCode(error);
        logger.error({
          event: "kirai_generation_failed",
          requestId: String(response.getHeader("X-Request-Id") ?? ""),
          code:
            error instanceof OllamaProviderError ? error.code : "unexpected",
          stage: generationStage,
        });
        response.status(503).json({
          error: {
            code: error instanceof OllamaProviderError ? code : "KIRAI_UNAVAILABLE",
            message: "KIRAI is temporarily unavailable. Your question was kept so you can retry it.",
            requestId: String(response.getHeader("X-Request-Id") ?? ""),
          },
        });
        return;
      }
    },
  );

  router.get("/conversations", authenticate, async (request, response, next) => {
    try {
      const ownerId = requirePrincipal(request).userId;
      response.set("Cache-Control", "no-store");
      response.status(200).json({ conversations: await store.listConversations(ownerId) });
    } catch (error) { next(error); }
  });

  router.get("/conversations/:conversationId/messages", authenticate, async (request, response) => {
    const ownerId = requirePrincipal(request).userId;
    const rawConversationId = request.params.conversationId;
    const conversationId = Array.isArray(rawConversationId) ? rawConversationId[0] ?? "" : rawConversationId;
    const offset = Number(request.query.offset ?? 0);
    const limit = Number(request.query.limit ?? 100);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId) ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Conversation page is invalid." } });
      return;
    }
    response.set("Cache-Control", "no-store");
    try {
      response.status(200).json(await store.listMessages(ownerId, conversationId.toLowerCase(), offset, limit));
    } catch (error) {
      if (error instanceof KiraiNotFoundError) response.status(404).json({ error: { code: "KIRAI_NOT_FOUND", message: "Conversation not found." } });
      else response.status(503).json({ error: { code: "KIRAI_UNAVAILABLE", message: "Conversation history is temporarily unavailable." } });
    }
  });

  return router;
}

function chatResult(conversationId: string, question: { id: string; content: string; createdAt: string }, answer: { id: string; content: string; createdAt: string; truncated: boolean }) {
  return {
    conversationId,
    userMessage: { id: question.id, content: question.content, createdAt: question.createdAt },
    assistantMessage: { id: answer.id, content: answer.content, createdAt: answer.createdAt, truncated: answer.truncated },
    answer: answer.content,
    truncated: answer.truncated,
  };
}
