import type { ErrorRequestHandler } from "express";
import type { Logger } from "../observability/logger.js";

interface PublicError {
  statusCode: number;
  code: string;
  message: string;
}

function publicError(error: unknown): PublicError {
  if (typeof error !== "object" || error === null) {
    return {
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    };
  }

  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : "INTERNAL_ERROR";
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return { statusCode, code, message };
}

function parserErrorType(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) {
    return undefined;
  }
  return typeof error.type === "string" ? error.type : undefined;
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _request, response, _next) => {
    const requestId = String(response.getHeader("X-Request-Id") ?? "");
    const parserType = parserErrorType(error);
    const apiError = publicError(error);
    let statusCode = apiError.statusCode;
    let code = apiError.code;
    let message = statusCode < 500 ? apiError.message : "An unexpected error occurred.";

    if (parserType === "entity.parse.failed") {
      statusCode = 400;
      code = "INVALID_JSON";
      message = "Request body must contain valid JSON.";
    } else if (parserType === "entity.too.large") {
      statusCode = 413;
      code = "BODY_TOO_LARGE";
      message = "Request body exceeds the allowed size.";
    }

    if (statusCode < 400 || statusCode > 599) {
      statusCode = 500;
      code = "INTERNAL_ERROR";
      message = "An unexpected error occurred.";
    }

    if (statusCode >= 500) {
      code = "INTERNAL_ERROR";
      message = "An unexpected error occurred.";
      logger.error({ event: "request_failed", requestId, statusCode });
    }

    response.status(statusCode).json({
      error: {
        code,
        message,
        requestId,
      },
    });
  };
}
