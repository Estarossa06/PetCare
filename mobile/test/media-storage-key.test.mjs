import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteMediaStorageKey } from "../src/features/sync/mediaStorageKey.ts";

test("downloaded media cache keys are isolated by local account", () => {
  const asset = "00000000-0000-4000-8000-000000000003";
  const accountA = "00000000-0000-4000-8000-000000000001";
  const accountB = "00000000-0000-4000-8000-000000000002";
  assert.notEqual(
    remoteMediaStorageKey(accountA, asset, "portrait.JPG", "pet_photo"),
    remoteMediaStorageKey(accountB, asset, "portrait.JPG", "pet_photo"),
  );
  assert.equal(
    remoteMediaStorageKey(accountA, asset, "lab report.pdf", "health_attachment"),
    `medical-files/remote-${accountA}-${asset}.pdf`,
  );
  assert.throws(() => remoteMediaStorageKey("../other", asset, "photo.jpg", "pet_photo"), /Invalid account/);
});
