import { localDateTimeToIso, nextOccurrence } from "./recurrence";
import type { CareSchedule } from "./types";

function assertEqual(name: string, actual: string | null, expected: string | null): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected ?? "null"}, received ${actual ?? "null"}.`);
  }
}

export function verifyCareRecurrence(): void {
  const daily: CareSchedule = { frequency: "daily", interval: 1, unit: "days" };
  const startBeforeDst = localDateTimeToIso("2026-03-07T08:30", "America/New_York");
  assertEqual(
    "daily recurrence across daylight-saving transition",
    nextOccurrence(startBeforeDst, daily, "America/New_York", null, startBeforeDst, startBeforeDst),
    "2026-03-08T12:30:00.000Z",
  );

  const monthly: CareSchedule = { frequency: "monthly", interval: 1, unit: "months" };
  const january = localDateTimeToIso("2026-01-31T09:00", "America/New_York");
  const february = nextOccurrence(january, monthly, "America/New_York", null, january, january);
  assertEqual("month-end recurrence", february, "2026-02-28T14:00:00.000Z");
  assertEqual(
    "month-end recurrence restores anchor day",
    february
      ? nextOccurrence(february, monthly, "America/New_York", null, february, january)
      : null,
    "2026-03-31T13:00:00.000Z",
  );

  const oneTime: CareSchedule = { frequency: "once", interval: 1, unit: "days" };
  assertEqual("one-time schedule completion", nextOccurrence(january, oneTime, "America/New_York", null, january), null);

  let rejectedMissingLocalTime = false;
  try {
    localDateTimeToIso("2026-03-08T02:30", "America/New_York");
  } catch {
    rejectedMissingLocalTime = true;
  }
  if (!rejectedMissingLocalTime) {
    throw new Error("Nonexistent local time during daylight-saving transition must be rejected.");
  }
}
