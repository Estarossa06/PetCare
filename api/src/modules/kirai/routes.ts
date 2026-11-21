import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthenticateMiddleware } from "../auth/middleware/authenticate.js";
import type { AuthStore } from "../auth/types.js";
import type { Logger } from "../../observability/logger.js";
import { OllamaProviderError } from "./providers/ollamaProvider.js";
import type { ModelProvider } from "./providers/model-provider.js";
import { KiraiConversationService } from "./service.js";
import { validateKiraiRequest } from "./validation.js";

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

      let result: Awaited<ReturnType<KiraiConversationService["answer"]>>;
      try {
        result = await service.answer(chatRequest.message, chatRequest.history);
      } catch (error) {
        const code = availabilityErrorCode(error);
        logger.error({
          event: "kirai_generation_failed",
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
        return;
      }
      response.status(200).json(result);
    },
  );

  return router;
}
