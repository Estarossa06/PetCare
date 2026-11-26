import assert from "node:assert/strict";
import test from "node:test";
import { resolveR2Endpoint } from "../src/modules/media/objectStore.js";

const accountId = "a".repeat(32);
const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

test("R2 endpoint accepts a raw account ID and the canonical HTTPS endpoint", () => {
  assert.equal(resolveR2Endpoint(accountId), endpoint);
  assert.equal(resolveR2Endpoint(endpoint), endpoint);
  assert.equal(resolveR2Endpoint(`${endpoint}/`), endpoint);
});

test("R2 endpoint rejects arbitrary hosts, credentials, paths and non-HTTPS URLs", () => {
  for (const invalid of [
    "not-an-account-id",
    "https://example.test",
    `http://${accountId}.r2.cloudflarestorage.com`,
    `${endpoint}/bucket/path`,
    `https://user:pass@${accountId}.r2.cloudflarestorage.com`,
    `${endpoint}?redirect=https://example.test`,
    `${endpoint}:8443`,
  ]) {
    assert.throws(() => resolveR2Endpoint(invalid), /canonical S3 endpoint/);
  }
});
