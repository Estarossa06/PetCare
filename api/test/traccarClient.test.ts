import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistanceMeters } from "../src/modules/pets/trackingRoutes.js";
import {
  loadTraccarConfig,
  TraccarClient,
  TraccarDeviceOwnershipError,
  TraccarUnavailableError,
} from "../src/modules/pets/traccarClient.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const config = { baseUrl: "https://gps.example.test", token: "private-test-token", timeoutMs: 100 };

test("Traccar configuration is optional and rejects insecure remote URLs", () => {
  assert.equal(loadTraccarConfig({}), null);
  assert.equal(loadTraccarConfig({ TRACCAR_URL: "http://127.0.0.1:8082", TRACCAR_TOKEN: "test", NODE_ENV: "development" })?.baseUrl, "http://127.0.0.1:8082");
  for (const env of [
    { TRACCAR_URL: "http://gps.example.test", TRACCAR_TOKEN: "test", NODE_ENV: "development" },
    { TRACCAR_URL: "http://127.0.0.1:8082", TRACCAR_TOKEN: "test", NODE_ENV: "production" },
    { TRACCAR_URL: "https://user:pass@gps.example.test", TRACCAR_TOKEN: "test", NODE_ENV: "production" },
    { TRACCAR_URL: "https://gps.example.test?token=leak", TRACCAR_TOKEN: "test", NODE_ENV: "production" },
    { TRACCAR_URL: "https://gps.example.test", NODE_ENV: "production" },
  ]) assert.throws(() => loadTraccarConfig(env));
});

test("position lookup proves Traccar device ownership before reading coordinates", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new TraccarClient(config, async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/api/devices/42")) return Response.json({ id: 42, attributes: { petcareOwnerId: OWNER } });
    return Response.json([{ deviceId: 42, latitude: 4.65, longitude: -74.1, fixTime: "2026-11-25T12:00:00Z", accuracy: 8 }]);
  });

  const position = await client.getLatestPosition(42, OWNER);
  assert.deepEqual(position, { latitude: 4.65, longitude: -74.1, fixTime: "2026-11-25T12:00:00Z", accuracy: 8 });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/api\/devices\/42$/);
  assert.match(requests[1].url, /\/api\/positions\?deviceId=42$/);
  for (const request of requests) {
    assert.equal((request.init?.headers as Record<string, string>).Authorization, "Bearer private-test-token");
    assert.equal(request.init?.redirect, "error");
  }
});

test("a device assigned to another PetCare account is denied before positions are requested", async () => {
  const paths: string[] = [];
  const client = new TraccarClient(config, async (input) => {
    paths.push(String(input));
    return Response.json({ id: 42, attributes: { petcareOwnerId: "00000000-0000-4000-8000-000000000002" } });
  });

  await assert.rejects(client.getLatestPosition(42, OWNER), TraccarDeviceOwnershipError);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /\/api\/devices\/42$/);
});

test("invalid coordinates, mismatched device IDs, and upstream errors are rejected without leaking credentials", async () => {
  const invalidClients = [
    new TraccarClient(config, async (input) => String(input).includes("/api/devices/")
      ? Response.json({ id: 42, attributes: { petcareOwnerId: OWNER } })
      : Response.json([{ deviceId: 42, latitude: 91, longitude: 0, fixTime: "2026-11-25T12:00:00Z" }])),
    new TraccarClient(config, async (input) => String(input).includes("/api/devices/")
      ? Response.json({ id: 42, attributes: { petcareOwnerId: OWNER } })
      : Response.json([{ deviceId: 7, latitude: 4, longitude: 4, fixTime: "2026-11-25T12:00:00Z" }])),
    new TraccarClient(config, async () => { throw new Error("private token and upstream host"); }),
  ];

  for (const client of invalidClients) {
    await assert.rejects(client.getLatestPosition(42, OWNER), (error: unknown) =>
      error instanceof TraccarUnavailableError && !error.message.includes("private token"));
  }
});

test("Traccar timeout, HTTP failures, malformed JSON, and empty positions are handled safely", async () => {
  const ownedDevice = (input: RequestInfo | URL) => String(input).includes("/api/devices/");
  const timeoutClient = new TraccarClient(config, async (input, init) => {
    if (ownedDevice(input)) return Response.json({ id: 42, attributes: { petcareOwnerId: OWNER } });
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  await assert.rejects(timeoutClient.getLatestPosition(42, OWNER), TraccarUnavailableError);

  const httpFailure = new TraccarClient(config, async (input) => ownedDevice(input)
    ? Response.json({ id: 42, attributes: { petcareOwnerId: OWNER } })
    : new Response("private upstream details", { status: 401 }));
  await assert.rejects(httpFailure.getLatestPosition(42, OWNER), TraccarUnavailableError);

  const malformedJson = new TraccarClient(config, async (input) => ownedDevice(input)
    ? Response.json({ id: 42, attributes: { petcareOwnerId: OWNER } })
    : new Response("not-json", { status: 200 }));
  await assert.rejects(malformedJson.getLatestPosition(42, OWNER), TraccarUnavailableError);

  const noFix = new TraccarClient(config, async (input) => ownedDevice(input)
    ? Response.json({ id: 42, attributes: { petcareOwnerId: OWNER } })
    : Response.json([]));
  assert.equal(await noFix.getLatestPosition(42, OWNER), null);
});

test("geofence distance uses bounded great-circle distance in meters", () => {
  assert.equal(calculateDistanceMeters(4.65, -74.1, 4.65, -74.1), 0);
  const oneDegreeAtEquator = calculateDistanceMeters(0, 0, 0, 1);
  assert.ok(oneDegreeAtEquator > 111_000 && oneDegreeAtEquator < 112_000);
  assert.equal(calculateDistanceMeters(0, 0, 0, 1), calculateDistanceMeters(0, 1, 0, 0));
});
