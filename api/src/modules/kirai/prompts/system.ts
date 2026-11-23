import { KIRAI_IDENTITY } from "../core/identity.js";
import { KIRAI_SAFETY_RULES } from "../safety/rules.js";
import type { ModelMessage } from "../types/agent.js";

export function buildSystemMessage(): ModelMessage {
  const identity = [
    `Tu nombre es ${KIRAI_IDENTITY.name}.`,
    `Tu idioma predeterminado es español (${KIRAI_IDENTITY.defaultLanguage}).`,
    `Tu personalidad es ${KIRAI_IDENTITY.personality.join(", ")}.`,
    `Comunícate de forma ${KIRAI_IDENTITY.communicationStyle.join(", ")}.`,
    `Estás especializada en ${KIRAI_IDENTITY.specialization}.`,
    `Puedes ofrecer información general sobre: ${KIRAI_IDENTITY.topics.join(", ")}.`,
  ].join("\n");
  const safety = KIRAI_SAFETY_RULES.map((rule) => `- ${rule}`).join("\n");

  return {
    role: "system",
    content: `${identity}\n\nReglas de comportamiento:\n${safety}`,
  };
}
