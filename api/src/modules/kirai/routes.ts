import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthenticateMiddleware } from "../auth/middleware/authenticate.js";
import type { AuthStore } from "../auth/types.js";
import type { Logger } from "../../observability/logger.js";
import { OllamaProviderError } from "./providers/ollamaProvider.js";
import type { ModelProvider } from "./providers/model-provider.js";
import { KiraiConversationService } from "./service.js";
import { validateKiraiMessage } from "./validation.js";

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

export function createKiraiRouter(
  provider: ModelProvider,
  authStore: AuthStore,
  accessTokenSecret: Uint8Array,
  logger: Logger,
): Router {
  const router = Router();
  const service = new KiraiConversationService(provider);
  const authenticate = createAuthenticateMiddleware(authStore, accessTokenSecret);

  router.post(
    "/chat",
    authenticate,
    createKiraiRateLimit(logger),
    async (request, response, next) => {
      let message: string;
      try {
        message = validateKiraiMessage(request.body);
      } catch (error) {
        next(error);
        return;
      }

      let result: Awaited<ReturnType<KiraiConversationService["answer"]>>;
      try {
        result = await service.answer(message);
      } catch (error) {
        logger.error({
          event: "kirai_generation_failed",
          requestId: String(response.getHeader("X-Request-Id") ?? ""),
          code:
            error instanceof OllamaProviderError
              ? error.code
              : "unexpected",
        });
        response.status(503).json({
          error: {
            code: "KIRAI_UNAVAILABLE",
            message: "KIRAI is temporarily unavailable.",
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
