import type { RequestHandler } from "express";
import type { Logger } from "../observability/logger.js";
import type { AppConfig } from "../config/env.js";

export function createCorsMiddleware(
  config: Pick<AppConfig, "corsOrigins">,
  logger: Logger,
): RequestHandler {
  const allowedOrigins = new Set(config.corsOrigins);

  return (request, response, next) => {
    response.vary("Origin");
    const origin = request.get("Origin");
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (request.method === "OPTIONS") {
      if (!origin) {
        next();
        return;
      }
      if (!allowedOrigins.has(origin)) {
        const requestId = String(response.getHeader("X-Request-Id") ?? "");
        logger.info({
          event: "cors_origin_rejected",
          requestId,
          method: request.method,
          path: request.path,
        });
        response.status(403).json({
          error: {
            code: "CORS_ORIGIN_NOT_ALLOWED",
            message: "Origin is not allowed.",
            requestId,
          },
        });
        return;
      }
      response.sendStatus(204);
      return;
    }

    next();
  };
}
