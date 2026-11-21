import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";
import type { Logger } from "../../observability/logger.js";

export function createAuthRateLimit(logger: Logger): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request, response) => {
      const requestId = String(response.getHeader("X-Request-Id") ?? "");
      logger.info({
        event: "auth_rate_limit_exceeded",
        requestId,
        path: request.path,
      });
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many authentication attempts. Try again later.",
          requestId,
        },
      });
    },
  });
}
