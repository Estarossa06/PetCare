import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabasePool } from "../src/db/pool.js";
import { migrations } from "../src/db/migrations/index.js";
import { PostgresAuthStore } from "../src/modules/auth/postgresAuthStore.js";
import type { Logger } from "../src/observability/logger.js";
import type { Pet } from "../src/modules/pets/types.js";

const databaseUrl = process.env.PETCARE_TEST_DATABASE_URL;
const integrationEnabled =
  Boolean(databaseUrl) && process.env.PETCARE_RUN_AUTH_DB_TESTS === "1";
const accessTokenSecret = Buffer.from(
  "postgres-pets-integration-secret-at-least-32-bytes",
);
const testPassword = "postgres pets integration password";

interface AuthResponse {
  accessToken: string;
  user: { id: string };
}

interface PetResponse {
  pet: Pet;
}

interface PetListResponse {
  pets: Pet[];
  pagination: { limit: number; offset: number; total: number };
}

const silentLogger: Logger = {
  info: () => {},
  error: () => {},
};

test(
  "PostgreSQL pets API persists records and isolates every operation by owner",
  {
    skip:
      !integrationEnabled &&
      "Set PETCARE_TEST_DATABASE_URL and PETCARE_RUN_AUTH_DB_TESTS=1 for petcare_test.",
  },
  async () => {
    assert.equal(
      new URL(databaseUrl!).pathname.replace(/^\//, ""),
      "petcare_test",
      "Refusing to connect unless PETCARE_TEST_DATABASE_URL names petcare_test.",
    );

    const pool = createDatabasePool(databaseUrl!);
    let server: Server | undefined;
    let fixturesStarted = false;
    const emails = [
      `pets-integration-${randomUUID()}@example.test`,
      `pets-integration-${randomUUID()}@example.test`,
    ];

    try {
      const databaseInfo = await pool.query<{ database: string }>(
        "SELECT current_database() AS database",
      );
      assert.equal(databaseInfo.rows[0].database, "petcare_test");

      const appliedResult = await pool.query<{
        version: number;
        name: string;
        checksum: string;
      }>("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
      const applied = new Map(appliedResult.rows.map((row) => [row.version, row]));
      for (const migration of migrations) {
        const row = applied.get(migration.version);
        assert.ok(row, `Migration ${migration.version} is required for pet tests.`);
        assert.equal(row.name, migration.name);
        assert.equal(
          row.checksum,
          createHash("sha256").update(migration.up.toString()).digest("hex"),
        );
      }

      const app = createApp({
        config: { corsOrigins: [], accessTokenSecret },
        database: pool,
        authStore: new PostgresAuthStore(pool),
        logger: silentLogger,
      });
      server = createServer(app);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const unauthenticated = await fetch(`${baseUrl}/pets`);
      assert.equal(unauthenticated.status, 401);
      const unauthenticatedCreate = await postJson(baseUrl, "/pets", {
        name: "Unauthenticated",
        species: "cat",
      });
      assert.equal(unauthenticatedCreate.status, 401);
      fixturesStarted = true;

      const ownerA = await register(baseUrl, emails[0]);
      const ownerB = await register(baseUrl, emails[1]);
      const injectedOwner = await postJson(
        baseUrl,
        "/pets",
        { name: "Injected", species: "cat", owner_id: ownerB.user.id },
        ownerA.accessToken,
      );
      assert.equal(injectedOwner.status, 400);

      const createdA = await postJson(
        baseUrl,
        "/pets",
        {
          name: "Luna",
          species: "cat",
          breed: "Siamese",
          sex: "female",
          approximateAgeMonths: 18,
          weightKg: 4.25,
          color: "cream",
          notes: "Indoor",
          photoStorageKey: "pet-photos/luna.jpg",
        },
        ownerA.accessToken,
      );
      assert.equal(createdA.status, 201);
      const luna = (await readJson<PetResponse>(createdA)).pet;
      assert.equal(luna.owner_id, ownerA.user.id);
      assert.equal(luna.version, 1);
      assert.equal(luna.weight_kg, 4.25);
      assert.equal(luna.approximate_age_months, 18);

      const createdSecond = await postJson(
        baseUrl,
        "/pets",
        { name: "Miso", species: "cat" },
        ownerA.accessToken,
      );
      assert.equal(createdSecond.status, 201);
      const miso = (await readJson<PetResponse>(createdSecond)).pet;

      const createdForB = await postJson(
        baseUrl,
        "/pets",
        { name: "Rocky", species: "dog" },
        ownerB.accessToken,
      );
      assert.equal(createdForB.status, 201);
      const rocky = (await readJson<PetResponse>(createdForB)).pet;

      const ownerAList = await readJson<PetListResponse>(
        await fetch(`${baseUrl}/pets`, {
          headers: { Authorization: `Bearer ${ownerA.accessToken}` },
        }),
      );
      assert.equal(ownerAList.pagination.total, 2);
      assert.deepEqual(
        ownerAList.pets.map((pet) => pet.id).sort(),
        [luna.id, miso.id].sort(),
      );

      const filtered = await readJson<PetListResponse>(
        await fetch(`${baseUrl}/pets?species=cat&search=siam&limit=1&offset=0`, {
          headers: { Authorization: `Bearer ${ownerA.accessToken}` },
        }),
      );
      assert.equal(filtered.pagination.total, 1);
      assert.equal(filtered.pets[0].id, luna.id);

      const page = await readJson<PetListResponse>(
        await fetch(`${baseUrl}/pets?species=cat&limit=1&offset=1`, {
          headers: { Authorization: `Bearer ${ownerA.accessToken}` },
        }),
      );
      assert.equal(page.pagination.total, 2);
      assert.equal(page.pets.length, 1);
      const invalidPetId = await fetch(`${baseUrl}/pets/not-a-uuid`, {
        headers: { Authorization: `Bearer ${ownerA.accessToken}` },
      });
      assert.equal(invalidPetId.status, 400);

      const ownerBList = await readJson<PetListResponse>(
        await fetch(`${baseUrl}/pets`, {
          headers: { Authorization: `Bearer ${ownerB.accessToken}` },
        }),
      );
      assert.deepEqual(ownerBList.pets.map((pet) => pet.id), [rocky.id]);

      const invalidPage = await fetch(`${baseUrl}/pets?limit=101`, {
        headers: { Authorization: `Bearer ${ownerA.accessToken}` },
      });
      assert.equal(invalidPage.status, 400);

      const invalidInputs = [
        { name: " ", species: "cat" },
        { name: "Luna", species: "cat", sex: "other" },
        { name: "Luna", species: "cat", birthDate: "2024-02-30" },
        { name: "Luna", species: "cat", weightKg: 0 },
        {
          name: "Luna",
          species: "cat",
          birthDate: "2020-01-01",
          approximateAgeMonths: 12,
        },
      ];
      for (const input of invalidInputs) {
        const response = await postJson(
          baseUrl,
          "/pets",
          input,
          ownerA.accessToken,
        );
        assert.equal(response.status, 400);
      }

      const ownerBGetA = await fetch(`${baseUrl}/pets/${luna.id}`, {
        headers: { Authorization: `Bearer ${ownerB.accessToken}` },
      });
      assert.equal(ownerBGetA.status, 404);
      const ownerBPatchA = await patchJson(
        baseUrl,
        `/pets/${luna.id}`,
        { name: "Stolen" },
        ownerB.accessToken,
      );
      assert.equal(ownerBPatchA.status, 404);
      const ownerBDeleteA = await fetch(`${baseUrl}/pets/${luna.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ownerB.accessToken}` },
      });
      assert.equal(ownerBDeleteA.status, 404);

      const updatedResponse = await patchJson(
        baseUrl,
        `/pets/${luna.id}`,
        { name: "Luna Updated", birthDate: "2022-05-04" },
        ownerA.accessToken,
      );
      assert.equal(updatedResponse.status, 200);
      const updated = (await readJson<PetResponse>(updatedResponse)).pet;
      assert.equal(updated.name, "Luna Updated");
      assert.equal(updated.birth_date, "2022-05-04");
      assert.equal(updated.approximate_age_months, null);
      assert.equal(updated.version, 2);

      const ageUpdatedResponse = await patchJson(
        baseUrl,
        `/pets/${luna.id}`,
        { approximateAgeMonths: 24 },
        ownerA.accessToken,
      );
      assert.equal(ageUpdatedResponse.status, 200);
      const ageUpdated = (await readJson<PetResponse>(ageUpdatedResponse)).pet;
      assert.equal(ageUpdated.birth_date, null);
      assert.equal(ageUpdated.approximate_age_months, 24);
      assert.equal(ageUpdated.version, 3);

      const fetched = await fetch(`${baseUrl}/pets/${luna.id}`, {
        headers: { Authorization: `Bearer ${ownerA.accessToken}` },
      });
      assert.equal(fetched.status, 200);
      assert.equal((await readJson<PetResponse>(fetched)).pet.id, luna.id);

      const invalidPatch = await patchJson(
        baseUrl,
        `/pets/${luna.id}`,
        { sex: "other" },
        ownerA.accessToken,
      );
      assert.equal(invalidPatch.status, 400);

      const deleted = await fetch(`${baseUrl}/pets/${luna.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ownerA.accessToken}` },
      });
      assert.equal(deleted.status, 204);
      const afterDelete = await fetch(`${baseUrl}/pets/${luna.id}`, {
        headers: { Authorization: `Bearer ${ownerA.accessToken}` },
      });
      assert.equal(afterDelete.status, 404);
      const deletedRow = await pool.query<{ deleted_at: Date | null }>(
        "SELECT deleted_at FROM pets WHERE owner_id = $1 AND id = $2",
        [ownerA.user.id, luna.id],
      );
      assert.ok(deletedRow.rows[0]?.deleted_at);
    } finally {
      if (server) {
        const closed = once(server, "close");
        server.close();
        await closed;
      }
      if (fixturesStarted) {
        await pool.query(
          "DELETE FROM pets WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))",
          [emails],
        );
        await pool.query(
          `DELETE FROM auth_refresh_tokens AS token
           USING auth_sessions AS session, users
           WHERE token.session_id = session.id
             AND session.user_id = users.id
             AND users.email = ANY($1::text[])`,
          [emails],
        );
        await pool.query(
          `DELETE FROM auth_sessions AS session
           USING users
           WHERE session.user_id = users.id AND users.email = ANY($1::text[])`,
          [emails],
        );
        await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
      }
      await pool.end();
    }
  },
);

async function register(baseUrl: string, email: string): Promise<AuthResponse> {
  const response = await postJson(baseUrl, "/auth/register", {
    email,
    password: testPassword,
    name: "Pets integration owner",
  });
  assert.equal(response.status, 201);
  return readJson<AuthResponse>(response);
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

async function patchJson(
  baseUrl: string,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
