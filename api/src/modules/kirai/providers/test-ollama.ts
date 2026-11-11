import "dotenv/config";
import { loadKiraiOllamaConfig } from "../../../config/kiraiOllama.js";
import { buildSystemMessage } from "../prompts/system.js";
import type { ModelMessage } from "../types/agent.js";
import { OllamaProvider } from "./ollamaProvider.js";
import type { ModelProvider } from "./model-provider.js";

async function main(): Promise<void> {
  const provider: ModelProvider = new OllamaProvider(loadKiraiOllamaConfig());
  const messages: ModelMessage[] = [
    buildSystemMessage(),
    {
      role: "user",
      content: "Explica en una frase por qué es importante que los perros tengan agua limpia.",
    },
  ];
  const response = await provider.generate({ messages });
  console.log(response.message.content);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ollama test failed.");
  process.exitCode = 1;
});
