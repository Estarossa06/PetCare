import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthenticateMiddleware, requirePrincipal } from "../../middleware/authenticate.js";
import type { Logger } from "../../observability/logger.js";
import { AuthService } from "./service.js";
import {
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidRequestError,
  type AuthStore,
} from "./types.js";

function createAuthRateLimit(logger: Logger) {
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

function requestObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidRequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function createAuthRouter(
  store: AuthStore,
  secret: Uint8Array,
  logger: Logger,
): Router {
  const router = Router();
  const service = new AuthService(store, secret);
  const authenticate = createAuthenticateMiddleware(store, secret);
  const limit = createAuthRateLimit(logger);

  router.post("/register", limit, async (request, response, next) => {
    try {
      const body = requestObject(request.body);
      const result = await service.register({
        email: body.email,
        password: body.password,
        name: body.name,
      });
      response.status(201).json(result);
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        response.status(409).json({
          error: {
            code: "REGISTRATION_FAILED",
            message: "Unable to create an account with the provided details.",
            requestId: String(response.getHeader("X-Request-Id") ?? ""),
          },
        });
        return;
      }
      if (error instanceof InvalidRequestError) {
        response.status(400).json({
          error: {
            code: error.code,
            message: error.message,
            requestId: String(response.getHeader("X-Request-Id") ?? ""),
          },
        });
        return;
      }
      next(error);
    }
  });

  router.post("/login", limit, async (request, response, next) => {
    try {
      const body = requestObject(request.body);
      response.status(200).json(
        await service.login({ email: body.email, password: body.password }),
      );
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Email or password is incorrect.",
            requestId: String(response.getHeader("X-Request-Id") ?? ""),
          },
        });
        return;
      }
      if (error instanceof InvalidRequestError) {
        response.status(400).json({
          error: {
            code: error.code,
            message: error.message,
            requestId: String(response.getHeader("X-Request-Id") ?? ""),
          },
        });
        return;
      }
      next(error);
    }
  });

  router.post("/refresh", limit, async (request, response, next) => {
    try {
      const body = requestObject(request.body);
      response.status(200).json(await service.refresh(body.refreshToken));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({
          error: {
            code: "INVALID_REFRESH_TOKEN",
            message: "Refresh token is invalid or expired.",
            requestId: String(response.getHeader("X-Request-Id") ?? ""),
          },
        });
        return;
      }
      if (error instanceof InvalidRequestError) {
        response.status(400).json({
          error: {
            code: error.code,
            message: error.message,
            requestId: String(response.getHeader("X-Request-Id") ?? ""),
          },
        });
        return;
      }
      next(error);
    }
  });

  router.post("/logout", authenticate, async (request, response, next) => {
    try {
      await service.logout(requirePrincipal(request));
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
