const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface PetVisionConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function loadPetVisionConfig(env: NodeJS.ProcessEnv = process.env): PetVisionConfig {
  const rawUrl = env.PET_VISION_OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PET_VISION_OLLAMA_BASE_URL must use HTTP on a loopback host only.");
  }
  const model = env.PET_VISION_OLLAMA_MODEL?.trim() || "qwen2.5vl:7b";
  const timeoutMs = Number(env.PET_VISION_TIMEOUT_MS ?? "90000");
  if (!model || model.length > 120 || /\s/.test(model)) throw new Error("PET_VISION_OLLAMA_MODEL must be a valid Ollama model name.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("PET_VISION_TIMEOUT_MS must be between 1 and 300000.");
  return { baseUrl: url.origin, model, timeoutMs };
}
