import express, { type Express } from "express";
import type { AppConfig } from "./config/env.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { createErrorHandler } from "./middleware/errors.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { createRequestLoggingMiddleware } from "./middleware/requestLogging.js";
import { requireJsonBody } from "./middleware/requireJsonBody.js";
import type { Queryable } from "./db/queryable.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import type { AuthStore } from "./modules/auth/types.js";
import { createTrackingRouter } from "./modules/pets/trackingRoutes.js";
import { createPetsRouter } from "./modules/pets/routes.js";
import { PostgresPetRepository } from "./modules/pets/repository.js";
import { PetService } from "./modules/pets/service.js";
import { loadKiraiOllamaConfig } from "./modules/kirai/config.js";
import { OllamaProvider } from "./modules/kirai/providers/ollamaProvider.js";
import type { ModelProvider } from "./modules/kirai/providers/model-provider.js";
import { createKiraiRouter } from "./modules/kirai/routes.js";
import type { Logger } from "./observability/logger.js";
import { createSystemRouter, type ReadinessDatabase } from "./modules/system/routes.js";

interface AppDependencies {
  config: Pick<AppConfig, "corsOrigins" | "accessTokenSecret">;
  database: Queryable & ReadinessDatabase;
  authStore: AuthStore;
  logger: Logger;
  kiraiProvider?: ModelProvider;
}

export function createApp({
  config,
  database,
  authStore,
  logger,
  kiraiProvider,
}: AppDependencies): Express {
  const app = express();
  const provider =
    kiraiProvider ?? new OllamaProvider(loadKiraiOllamaConfig());

  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(createRequestLoggingMiddleware(logger));
  app.use(createCorsMiddleware(config, logger));
  app.use(requireJsonBody);
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use("/auth", createAuthRouter(authStore, config.accessTokenSecret, logger));
  app.use(
    "/pets",
    createPetsRouter(
      new PetService(new PostgresPetRepository(database)),
      authStore,
      config.accessTokenSecret,
    ),
  );
  app.use("/tracking", createTrackingRouter(database, new PetService(new PostgresPetRepository(database)), authStore, config.accessTokenSecret));
  app.use(
    "/kirai",
    createKiraiRouter(
      provider,
      authStore,
      config.accessTokenSecret,
      logger,
    ),
  );
  app.use("/", createSystemRouter(database, logger));
  app.use((_request, _response, next) => {
    next(
      Object.assign(new Error("Route not found."), {
        statusCode: 404,
        code: "NOT_FOUND",
      }),
    );
  });
  app.use(createErrorHandler(logger));

  return app;
}
