import { Router } from "express";
import { createAuthenticateMiddleware, requirePrincipal } from "./middleware/authenticate.js";
import type { Logger } from "../../observability/logger.js";
import { AuthService } from "./service.js";
import type { AuthStore } from "./types.js";
import { AuthController } from "./controller.js";
import { createAuthRateLimit } from "./rateLimit.js";

export function createAuthRouter(store: AuthStore, secret: Uint8Array, logger: Logger): Router {
  const router = Router();
  const service = new AuthService(store, secret);
  const controller = new AuthController(service);
  const authenticate = createAuthenticateMiddleware(store, secret);
  const limit = createAuthRateLimit(logger);

  router.post("/register", limit, controller.register);
  router.post("/login", limit, controller.login);
  router.post("/refresh", limit, controller.refresh);
  router.get("/me", authenticate, controller.currentUser);
  router.patch("/me", authenticate, controller.updateProfile);
  router.post("/password", authenticate, controller.changePassword);
  router.post("/deactivate", authenticate, controller.deactivateAccount);
  router.post("/deletion-request", authenticate, controller.requestPermanentDeletion);
  router.post("/logout", authenticate, controller.logout);

  return router;
}
