import type { RequestHandler } from "express";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import type { AuthStore, Principal } from "../modules/auth/types.js";

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

export function createAuthenticateMiddleware(
  store: AuthStore,
  secret: Uint8Array,
): RequestHandler {
  return async (request, response, next) => {
    const authorization = request.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      response.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
          requestId: String(response.getHeader("X-Request-Id") ?? ""),
        },
      });
      return;
    }

    let principal: Principal;
    try {
      principal = await verifyAccessToken(authorization.slice(7), secret);
    } catch {
      response.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
          requestId: String(response.getHeader("X-Request-Id") ?? ""),
        },
      });
      return;
    }

    if (!(await store.isSessionActive(principal))) {
      response.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
          requestId: String(response.getHeader("X-Request-Id") ?? ""),
        },
      });
      return;
    }

    request.principal = principal;
    next();
  };
}

export function requirePrincipal(
  request: Express.Request,
): Principal {
  if (!request.principal) {
    throw new Error("Authenticated route is missing its principal.");
  }
  return request.principal;
}
