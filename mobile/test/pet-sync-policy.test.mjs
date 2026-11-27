import assert from "node:assert/strict";
import { test } from "node:test";
import { isRetryDue, retryDelayMilliseconds } from "../src/features/sync/petSyncPolicy.ts";

test("offline retries use bounded exponential backoff", () => {
  assert.deepEqual([1, 2, 3, 4, 12].map(retryDelayMilliseconds), [5_000, 10_000, 20_000, 40_000, 3_600_000]);
  assert.throws(() => retryDelayMilliseconds(0));
});

test("pending sync retries only when the persisted retry time is due", () => {
  assert.equal(isRetryDue(null, "2026-01-01T00:00:00.000Z"), true);
  assert.equal(isRetryDue("2026-01-01T00:00:10.000Z", "2026-01-01T00:00:09.000Z"), false);
  assert.equal(isRetryDue("2026-01-01T00:00:10.000Z", "2026-01-01T00:00:10.000Z"), true);
  assert.equal(isRetryDue("invalid", "2026-01-01T00:00:10.000Z"), false);
});
