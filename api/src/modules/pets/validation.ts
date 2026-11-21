import { InvalidPetRequestError } from "./errors.js";
import type {
  CreatePetInput,
  PetSex,
  UpdatePetInput,
} from "./types.js";

const PET_FIELDS = new Set([
  "name",
  "species",
  "breed",
  "sex",
  "birthDate",
  "approximateAgeMonths",
  "weightKg",
  "color",
  "notes",
  "photoStorageKey",
]);
const PET_SEX_VALUES = new Set<PetSex>(["female", "male", "unknown"]);

function requestObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPetRequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(body: Record<string, unknown>): void {
  const unexpected = Object.keys(body).find((key) => !PET_FIELDS.has(key));
  if (unexpected) {
    throw new InvalidPetRequestError(`Unexpected pet field: ${unexpected}.`);
  }
}

function requiredText(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new InvalidPetRequestError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new InvalidPetRequestError(
      `${field} must contain between 1 and ${maximumLength} characters.`,
    );
  }
  return normalized;
}

function nullableText(
  value: unknown,
  field: string,
  maximumLength: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new InvalidPetRequestError(`${field} must be a string or null.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new InvalidPetRequestError(
      `${field} must not exceed ${maximumLength} characters.`,
    );
  }
  return normalized || null;
}

function petSex(value: unknown): PetSex | null {
  if (value === null) return null;
  if (value === "female" || value === "male" || value === "unknown") return value;
  throw new InvalidPetRequestError("sex must be female, male, unknown, or null.");
}

function birthDate(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !isCalendarDate(value)
  ) {
    throw new InvalidPetRequestError("birthDate must be a valid YYYY-MM-DD date or null.");
  }
  if (value > new Date().toISOString().slice(0, 10)) {
    throw new InvalidPetRequestError("birthDate cannot be in the future.");
  }
  return value;
}

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function approximateAgeMonths(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 2_147_483_647
  ) {
    throw new InvalidPetRequestError(
      "approximateAgeMonths must be a non-negative integer or null.",
    );
  }
  return value;
}

function weightKg(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 9_999.999 ||
    Math.round(value * 1_000) !== value * 1_000
  ) {
    throw new InvalidPetRequestError(
      "weightKg must be greater than zero, have at most three decimals, and not exceed 9999.999.",
    );
  }
  return value;
}

function fieldValue(
  body: Record<string, unknown>,
  key: keyof UpdatePetInput,
): unknown {
  return body[key];
}

function validateFields(
  body: Record<string, unknown>,
  partial: boolean,
): UpdatePetInput {
  const result: UpdatePetInput = {};
  const parsers: {
    key: keyof UpdatePetInput;
    parse: (value: unknown) => UpdatePetInput[keyof UpdatePetInput];
  }[] = [
    { key: "name", parse: (value) => requiredText(value, "name", 200) },
    { key: "species", parse: (value) => requiredText(value, "species", 100) },
    { key: "breed", parse: (value) => nullableText(value, "breed", 150) },
    { key: "sex", parse: petSex },
    { key: "birthDate", parse: birthDate },
    { key: "approximateAgeMonths", parse: approximateAgeMonths },
    { key: "weightKg", parse: weightKg },
    { key: "color", parse: (value) => nullableText(value, "color", 100) },
    { key: "notes", parse: (value) => nullableText(value, "notes", 10_000) },
    {
      key: "photoStorageKey",
      parse: (value) => nullableText(value, "photoStorageKey", 2_048),
    },
  ];

  for (const { key, parse } of parsers) {
    if (Object.hasOwn(body, key)) {
      Object.assign(result, { [key]: parse(fieldValue(body, key)) });
    } else if (!partial && key !== "name" && key !== "species") {
      Object.assign(result, { [key]: null });
    }
  }

  if (!partial) {
    result.name = requiredText(body.name, "name", 200);
    result.species = requiredText(body.species, "species", 100);
  }
  return result;
}

export function validateCreatePet(value: unknown): CreatePetInput {
  const body = requestObject(value);
  rejectUnknownFields(body);
  const fields = validateFields(body, false);
  if (fields.birthDate !== null && fields.approximateAgeMonths !== null) {
    throw new InvalidPetRequestError(
      "Provide birthDate or approximateAgeMonths, not both.",
    );
  }
  return {
    ...fields,
    name: requiredText(body.name, "name", 200),
    species: requiredText(body.species, "species", 100),
  };
}

export function validateUpdatePet(value: unknown): UpdatePetInput {
  const body = requestObject(value);
  rejectUnknownFields(body);
  if (Object.keys(body).length === 0) {
    throw new InvalidPetRequestError("At least one pet field must be provided.");
  }
  return validateFields(body, true);
}

function queryString(
  value: unknown,
  field: string,
  maximumLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new InvalidPetRequestError(`${field} must be a single string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new InvalidPetRequestError(
      `${field} must not exceed ${maximumLength} characters.`,
    );
  }
  return normalized || undefined;
}

function queryInteger(
  value: unknown,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new InvalidPetRequestError(`${field} must be a non-negative integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new InvalidPetRequestError(
      `${field} must be between ${minimum} and ${maximum}.`,
    );
  }
  return number;
}

export function validatePetListQuery(value: unknown): {
  search?: string;
  species?: string;
  limit: number;
  offset: number;
} {
  const query = requestObject(value);
  const allowed = new Set(["search", "species", "limit", "offset"]);
  const unexpected = Object.keys(query).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new InvalidPetRequestError(`Unexpected query parameter: ${unexpected}.`);
  }
  return {
    search: queryString(query.search, "search", 100),
    species: queryString(query.species, "species", 100),
    limit: queryInteger(query.limit, "limit", 50, 1, 100),
    offset: queryInteger(query.offset, "offset", 0, 0, 1_000_000),
  };
}

export function validatePetId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new InvalidPetRequestError("petId must be a valid UUID.");
  }
  return value.toLowerCase();
}
