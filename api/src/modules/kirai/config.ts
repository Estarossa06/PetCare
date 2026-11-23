export interface KiraiOllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_KIRAI_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_KIRAI_OLLAMA_MODEL = "qwen3:8b";
export const DEFAULT_KIRAI_OLLAMA_TIMEOUT_MS = 60_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function parseBaseUrl(value: string | undefined): string {
  const raw = value === undefined ? DEFAULT_KIRAI_OLLAMA_BASE_URL : value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("KIRAI_OLLAMA_BASE_URL must be a valid loopback HTTP URL.");
  }

  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("KIRAI_OLLAMA_BASE_URL must use HTTP on a loopback host only.");
  }

  return url.origin;
}

function parseModel(value: string | undefined): string {
  const model = value === undefined ? DEFAULT_KIRAI_OLLAMA_MODEL : value.trim();
  if (!model || model.length > 120 || /\s/.test(model)) {
    throw new Error("KIRAI_OLLAMA_MODEL must be a valid Ollama model name.");
  }
  return model;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_KIRAI_OLLAMA_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error("KIRAI_OLLAMA_TIMEOUT_MS must be between 1 and 300000.");
  }
  return timeoutMs;
}

export function loadKiraiOllamaConfig(
  env: NodeJS.ProcessEnv = process.env,
): KiraiOllamaConfig {
  return {
    baseUrl: parseBaseUrl(env.KIRAI_OLLAMA_BASE_URL),
    model: parseModel(env.KIRAI_OLLAMA_MODEL),
    timeoutMs: parseTimeout(env.KIRAI_OLLAMA_TIMEOUT_MS),
  };
}
