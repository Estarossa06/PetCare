import assert from "node:assert/strict";
import { test } from "node:test";
import { getReminderRoute } from "./navigation.ts";

function response(actionIdentifier, reminderId) {
  return {
    actionIdentifier,
    notification: {
      date: Date.now(),
      request: {
        identifier: "notification-id",
        content: { data: { reminderId } },
        trigger: null,
      },
    },
  };
}

test("notification taps navigate only to a valid reminder route", () => {
  assert.equal(
    getReminderRoute(
      response("default", "1B7A3D8E-7DC7-4E8E-9DC8-4EDBB31E90E7"),
      "default",
    ),
    "/calendar/reminder/1b7a3d8e-7dc7-4e8e-9dc8-4edbb31e90e7",
  );
  assert.equal(
    getReminderRoute(
      response("snooze", "1b7a3d8e-7dc7-4e8e-9dc8-4edbb31e90e7"),
      "default",
    ),
    null,
  );
  assert.equal(getReminderRoute(response("default", "not-a-uuid"), "default"), null);
});
