import { type RequestHandler } from "express";
import type { Logger } from "../observability/logger.js";

export function createRequestLoggingMiddleware(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const startedAt = process.hrtime.bigint();
    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info({
        event: "request_completed",
        requestId: String(response.getHeader("X-Request-Id") ?? ""),
        method: request.method,
        path: request.route?.path ?? "unmatched",
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}
