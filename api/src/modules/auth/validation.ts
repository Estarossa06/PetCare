import { InvalidCredentialsError, InvalidRequestError } from "./errors.js";
import { validatePassword } from "./passwords.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export function validateRegisterInput(value: unknown): RegisterInput {
  const body = requestObject(value);
  return {
    email: normalizeEmail(body.email),
    password: normalizePassword(body.password),
    name: normalizeName(body.name),
  };
}

export function validateLoginInput(value: unknown): LoginInput {
  const body = requestObject(value);
  return {
    email: normalizeEmail(body.email),
    password: normalizePassword(body.password),
  };
}

export function validateRefreshToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 32 || value.length > 128) {
    throw new InvalidCredentialsError();
  }
  return value;
}

function requestObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidRequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidRequestError("A valid email is required.");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new InvalidRequestError("A valid email is required.");
  }
  return email;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidRequestError("Password must be between 12 and 128 characters.");
  }
  try {
    validatePassword(value);
  } catch {
    throw new InvalidRequestError("Password must be between 12 and 128 characters.");
  }
  return value;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidRequestError("Name must be between 1 and 100 characters.");
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 100) {
    throw new InvalidRequestError("Name must be between 1 and 100 characters.");
  }
  return name;
}
