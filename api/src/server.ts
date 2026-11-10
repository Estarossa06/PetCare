import "dotenv/config";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { createApp } from "./app.js";
import { loadConfig, type AppConfig } from "./config/env.js";
import { createDatabasePool } from "./db/pool.js";
import { PostgresAuthStore } from "./modules/auth/postgresAuthStore.js";
import { logger } from "./observability/logger.js";

export interface RunningServer {
  server: Server;
  close(): Promise<void>;
}

export async function startServer(config: AppConfig = loadConfig()): Promise<RunningServer> {
  const pool = createDatabasePool(config.databaseUrl);
  pool.on("error", (error: Error & { code?: string }) => {
    logger.error({
      event: "database_pool_error",
      ...(error.code ? { code: error.code } : {}),
    });
  });

  const app = createApp({
    config,
    database: pool,
    authStore: new PostgresAuthStore(pool),
    logger,
  });
  const server = createServer(app);

  try {
    server.listen(config.port, config.host);
    await once(server, "listening");
  } catch (error) {
    await pool.end();
    throw error;
  }

  logger.info({
    event: "server_started",
    host: config.host,
    port: config.port,
    nodeEnv: config.nodeEnv,
  });

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closing) {
      closing = new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      }).then(() => pool.end());
    }
    return closing;
  };

  return { server, close };
}

async function main(): Promise<void> {
  const running = await startServer();
  let isClosing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (isClosing) {
      return;
    }
    isClosing = true;
    logger.info({ event: "shutdown_started", signal });
    void running.close().then(
      () => logger.info({ event: "shutdown_completed" }),
      () => {
        logger.error({ event: "shutdown_failed" });
        process.exitCode = 1;
      },
    );
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected startup failure.";
    logger.error({ event: "server_start_failed", message });
    process.exitCode = 1;
  });
}
