import express, { type Express } from "express";
import type { AppConfig } from "./config/env.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { createErrorHandler } from "./middleware/errors.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { createRequestLoggingMiddleware } from "./middleware/requestLogging.js";
import { requireJsonBody } from "./middleware/requireJsonBody.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import type { AuthStore } from "./modules/auth/types.js";
import type { Logger } from "./observability/logger.js";
import { createSystemRouter, type ReadinessDatabase } from "./routes/system.js";

interface AppDependencies {
  config: Pick<AppConfig, "corsOrigins" | "accessTokenSecret">;
  database: ReadinessDatabase;
  authStore: AuthStore;
  logger: Logger;
}

export function createApp({
  config,
  database,
  authStore,
  logger,
}: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(createRequestLoggingMiddleware(logger));
  app.use(createCorsMiddleware(config, logger));
  app.use(requireJsonBody);
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use("/auth", createAuthRouter(authStore, config.accessTokenSecret, logger));
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
