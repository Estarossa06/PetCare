import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthenticateMiddleware } from "../auth/middleware/authenticate.js";
import type { AuthStore } from "../auth/types.js";
import type { Logger } from "../../observability/logger.js";
import type { PetVisionProvider } from "./types.js";
import { validateAndNormalizePetImage } from "./imageValidation.js";

export function createPetIdentificationRouter(provider: PetVisionProvider, authStore: AuthStore, accessTokenSecret: Uint8Array, logger: Logger): Router {
  const router = Router();
  router.use(createAuthenticateMiddleware(authStore, accessTokenSecret));
  router.post("/analyze", rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false }), express.json({ limit: "2mb", strict: true }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const image = await validateAndNormalizePetImage(request.body?.image);
      const result = await provider.identify(image);
      response.status(200).json(result);
    } catch (error) {
      const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 503;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "VISION_UNAVAILABLE";
      const message = status < 500 && error instanceof Error ? error.message : "No se pudo analizar la fotografía. Puedes completar el perfil manualmente.";
      if (status >= 500) logger.error({ event: "pet_vision_analysis_failed", requestId: String(response.getHeader("X-Request-Id") ?? ""), code });
      response.status(status).json({ error: { code, message, requestId: String(response.getHeader("X-Request-Id") ?? "") } });
    }
  });
  return router;
}
