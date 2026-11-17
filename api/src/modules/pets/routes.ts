import { Router } from "express";
import type { AuthStore } from "../auth/types.js";
import { createAuthenticateMiddleware } from "../auth/middleware/authenticate.js";
import { PetController } from "./controller.js";
import { PetService } from "./service.js";

export function createPetsRouter(
  service: PetService,
  authStore: AuthStore,
  accessTokenSecret: Uint8Array,
): Router {
  const router = Router();
  const controller = new PetController(service);
  router.use(createAuthenticateMiddleware(authStore, accessTokenSecret));
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.get("/:petId", controller.getById);
  router.patch("/:petId", controller.update);
  router.delete("/:petId", controller.delete);
  return router;
}
