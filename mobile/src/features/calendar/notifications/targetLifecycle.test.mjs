import assert from "node:assert/strict";
import { test } from "node:test";
import { isTerminalReminderTarget } from "./targetLifecycle.ts";

test("terminal calendar targets invalidate both fixed and relative reminders", () => {
  assert.equal(isTerminalReminderTarget("calendar_event", { status: "completed" }), true);
  assert.equal(isTerminalReminderTarget("appointment", { status: "cancelled" }), true);
  assert.equal(isTerminalReminderTarget("care_task", { enabled: 0 }), true);
  assert.equal(isTerminalReminderTarget("health_record", null), true);
});

test("active targets keep fixed-time reminders while relative reminders can be refreshed", () => {
  assert.equal(isTerminalReminderTarget("calendar_event", { status: "scheduled" }), false);
  assert.equal(isTerminalReminderTarget("appointment", { status: "scheduled" }), false);
  assert.equal(isTerminalReminderTarget("care_task", { enabled: 1 }), false);
  assert.equal(isTerminalReminderTarget("health_record", {}), false);
});
