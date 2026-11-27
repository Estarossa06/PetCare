export type NodeEnvironment = "development" | "test" | "production";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  host: string;
  databaseUrl: string;
  corsOrigins: readonly string[];
  accessTokenSecret: Uint8Array;
  r2?: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };
}

function requiredValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required. See api/.env.example.`);
  }
  return trimmed;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export function loadDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const connectionString = requiredValue(env.DATABASE_URL, "DATABASE_URL");
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.pathname.slice(1)
  ) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  return connectionString;
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value.split(",").map((entry) => {
    const origin = entry.trim();
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS must contain comma-separated HTTP(S) origins.");
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw new Error("CORS_ORIGINS must contain comma-separated HTTP(S) origins.");
    }
    return origin;
  });
}

function parseAccessTokenSecret(value: string | undefined): Uint8Array {
  const secret = requiredValue(value, "AUTH_ACCESS_TOKEN_SECRET");
  const bytes = Buffer.from(secret, "utf8");
  if (bytes.byteLength < 32) {
    throw new Error("AUTH_ACCESS_TOKEN_SECRET must contain at least 32 bytes.");
  }
  return bytes;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (
    nodeEnv !== "development" &&
    nodeEnv !== "test" &&
    nodeEnv !== "production"
  ) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }

  const host = env.HOST?.trim() || "127.0.0.1";
  if (/\s/.test(host)) {
    throw new Error("HOST must be a valid hostname or IP address.");
  }

  const r2Values = [env.R2_ACCOUNT_ID, env.R2_BUCKET, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY].map((value) => value?.trim() ?? "");
  if (r2Values.some(Boolean) && r2Values.some((value) => !value)) {
    throw new Error("R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be configured together.");
  }

  return {
    nodeEnv,
    port: parsePort(env.PORT),
    host,
    databaseUrl: loadDatabaseUrl(env),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    accessTokenSecret: parseAccessTokenSecret(env.AUTH_ACCESS_TOKEN_SECRET),
    ...(r2Values.every(Boolean) ? { r2: { accountId: r2Values[0]!, bucket: r2Values[1]!, accessKeyId: r2Values[2]!, secretAccessKey: r2Values[3]! } } : {}),
  };
}
