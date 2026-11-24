import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuthRouteGuards } from "../src/features/auth/routeAccess.ts";

test("route guards render no application or auth route while restoring the session", () => {
  assert.deepEqual(getAuthRouteGuards(true, false), {
    loading: true,
    authentication: false,
    application: false,
  });
  assert.deepEqual(getAuthRouteGuards(true, true), {
    loading: true,
    authentication: false,
    application: false,
  });
});

test("unauthenticated users only enable the authentication route group", () => {
  assert.deepEqual(getAuthRouteGuards(false, false), {
    loading: false,
    authentication: true,
    application: false,
  });
});

test("authenticated users only enable application routes", () => {
  assert.deepEqual(getAuthRouteGuards(false, true), {
    loading: false,
    authentication: false,
    application: true,
  });
});
