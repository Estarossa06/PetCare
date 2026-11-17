export const MAX_KIRAI_MESSAGE_LENGTH = 2_000;

export class InvalidKiraiMessageError extends Error {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";

  constructor() {
    super(`Message must be a non-empty string of at most ${MAX_KIRAI_MESSAGE_LENGTH} characters.`);
    this.name = "InvalidKiraiMessageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateKiraiMessage(body: unknown): string {
  if (!isRecord(body) || typeof body.message !== "string") {
    throw new InvalidKiraiMessageError();
  }

  const message = body.message.trim();
  if (!message || message.length > MAX_KIRAI_MESSAGE_LENGTH) {
    throw new InvalidKiraiMessageError();
  }
  return message;
}
