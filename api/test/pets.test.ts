import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { createApp } from "../src/app.js";
import type { Queryable } from "../src/db/queryable.js";
import {
  validateCreatePet,
  validatePetId,
  validatePetListQuery,
  validateUpdatePet,
} from "../src/modules/pets/validation.js";
import type { Logger, LogFields } from "../src/observability/logger.js";
import { MemoryAuthStore } from "./memoryAuthStore.js";

const SECRET = Buffer.from("pets-test-secret-with-at-least-32-bytes");
const PASSWORD = "correct horse battery staple";

async function listen(app: ReturnType<typeof createApp>): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  const closed = once(server, "close");
  server.close();
  await closed;
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("pet validation preserves nullable fields and rejects invalid profile data", () => {
  const pet = validateCreatePet({
    name: " Luna ",
    species: " Cat ",
    approximateAgeMonths: 12,
    weightKg: 4.25,
  });
  assert.equal(pet.name, "Luna");
  assert.equal(pet.species, "Cat");
  assert.equal(pet.approximateAgeMonths, 12);
  assert.equal(pet.breed, null);

  for (const input of [
    { name: "", species: "cat" },
    { name: "Luna", species: "cat", sex: "other" },
    { name: "Luna", species: "cat", birthDate: "2025-02-30" },
    { name: "Luna", species: "cat", birthDate: "2020-01-01", approximateAgeMonths: 4 },
    { name: "Luna", species: "cat", weightKg: 0 },
    { name: "Luna", species: "cat", owner_id: "attacker" },
  ]) {
    assert.throws(() => validateCreatePet(input));
  }

  assert.deepEqual(validateUpdatePet({ notes: null }), { notes: null });
  assert.throws(() => validateUpdatePet({}));
  assert.throws(() => validatePetId(["not-a-uuid"]));
});

test("pet list query validates supported filters and pagination bounds", () => {
  assert.deepEqual(validatePetListQuery({ limit: "25", offset: "5", search: "  cat " }), {
    search: "cat",
    species: undefined,
    limit: 25,
    offset: 5,
  });
  for (const query of [
    { limit: "0" },
    { limit: "101" },
    { offset: "-1" },
    { offset: "1.5" },
    { search: ["cat", "dog"] },
    { unexpected: "value" },
  ]) {
    assert.throws(() => validatePetListQuery(query));
  }
});

test("PostgreSQL errors on pet reads are returned as sanitized API errors", async () => {
  const entries: LogFields[] = [];
  const logger: Logger = {
    info: (fields) => entries.push(fields),
    error: (fields) => entries.push(fields),
  };
  const database: Queryable = {
    async query<Row extends QueryResultRow>(): Promise<{ rows: Row[] }> {
      throw new Error("sensitive PostgreSQL connection details");
    },
  };
  const app = createApp({
    config: { corsOrigins: [], accessTokenSecret: SECRET },
    database,
    authStore: new MemoryAuthStore(),
    logger,
  });
  const running = await listen(app);

  try {
    const registration = await postJson(running.baseUrl, "/auth/register", {
      email: "pets-error@example.test",
      password: PASSWORD,
      name: "Pets Error",
    });
    const credentials: { accessToken: string } = await registration.json();
    const response = await fetch(`${running.baseUrl}/pets`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(body, /INTERNAL_ERROR/);
    assert.equal(body.includes("sensitive PostgreSQL"), false);
    assert.ok(entries.some((entry) => entry.event === "request_failed"));
  } finally {
    await close(running.server);
  }
});
