import { Router } from "express";
import type { Logger } from "../observability/logger.js";

export interface ReadinessDatabase {
  query(text: string): Promise<unknown>;
}

export function createSystemRouter(
  database: ReadinessDatabase,
  logger: Logger,
): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  router.get("/ready", async (_request, response) => {
    const requestId = String(response.getHeader("X-Request-Id") ?? "");
    try {
      await database.query("SELECT 1");
      response.status(200).json({
        status: "ready",
        dependencies: { database: "available" },
      });
    } catch {
      logger.error({ event: "readiness_check_failed", requestId });
      response.status(503).json({
        status: "not_ready",
        dependencies: { database: "unavailable" },
      });
    }
  });

  return router;
}
