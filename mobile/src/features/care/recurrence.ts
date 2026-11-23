import type { CareSchedule } from "./types";

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatter = (timezone: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date, timezone: string): LocalParts {
  const parts = partsFormatter(timezone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function sameLocalTime(left: LocalParts, right: LocalParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function zonedDate(parts: LocalParts, timezone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let candidate = naive;
  for (let attempt = 0; attempt < 4; attempt++) {
    const observed = localParts(new Date(candidate), timezone);
    if (sameLocalTime(observed, parts)) return new Date(candidate);
    const observedNaive = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    candidate += naive - observedNaive;
  }

  const desiredMinute = parts.hour * 60 + parts.minute;
  const start = candidate - 4 * 60 * 60 * 1000;
  let firstAfterGap: Date | null = null;
  let firstAfterMinute = Infinity;
  for (let offset = 0; offset <= 8 * 60; offset++) {
    const test = new Date(start + offset * 60 * 1000);
    const observed = localParts(test, timezone);
    if (observed.year !== parts.year || observed.month !== parts.month || observed.day !== parts.day) continue;
    const observedMinute = observed.hour * 60 + observed.minute;
    if (observedMinute >= desiredMinute && observedMinute < firstAfterMinute) {
      firstAfterGap = test;
      firstAfterMinute = observedMinute;
    }
  }
  if (firstAfterGap) return firstAfterGap;
  throw new Error("Could not resolve this local time in the selected timezone.");
}

export function localDateTimeToIso(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("La fecha y hora debe tener formato AAAA-MM-DD HH:mm.");
  }
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const parts = { year, month, day, hour, minute, second: 0 };
  const converted = zonedDate(parts, timezone);
  const check = localParts(converted, timezone);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) {
    throw new Error("La hora local no existe por un cambio de horario; elige otra hora.");
  }
  return converted.toISOString();
}

export function isoToLocalDateTime(value: string, timezone: string): string {
  const parts = localParts(new Date(value), timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function nextOccurrence(
  scheduledAt: string,
  schedule: CareSchedule,
  timezone: string,
  endsAt: string | null,
  after: string,
  anchorAt = scheduledAt,
): string | null {
  if (schedule.frequency === "once") return null;
  if (!Number.isInteger(schedule.interval) || schedule.interval < 1) {
    throw new Error("La frecuencia debe tener un intervalo entero mayor que cero.");
  }
  const unit: "days" | "weeks" | "months" =
    schedule.frequency === "daily" ? "days" :
      schedule.frequency === "weekly" ? "weeks" :
        schedule.frequency === "monthly" ? "months" : schedule.unit;
  const amount = schedule.frequency === "daily" || schedule.frequency === "weekly" || schedule.frequency === "monthly"
    ? 1
    : schedule.interval;
  const anchor = localParts(new Date(anchorAt), timezone);
  let cursor = new Date(scheduledAt);
  const boundary = new Date(after);
  let attempts = 0;
  do {
    const current = localParts(cursor, timezone);
    let target: LocalParts;
    if (unit === "months") {
      const monthStart = new Date(Date.UTC(current.year, current.month - 1 + amount, 1));
      const targetYear = monthStart.getUTCFullYear();
      const targetMonth = monthStart.getUTCMonth() + 1;
      const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
      target = {
        ...anchor,
        year: targetYear,
        month: targetMonth,
        day: Math.min(anchor.day, daysInMonth),
      };
    } else {
      const days = amount * (unit === "weeks" ? 7 : 1);
      const next = new Date(Date.UTC(current.year, current.month - 1, current.day + days));
      target = {
        ...anchor,
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
      };
    }
    cursor = zonedDate(target, timezone);
    attempts++;
    if (attempts > 10000) throw new Error("La frecuencia produjo demasiadas fechas pendientes.");
  } while (cursor.getTime() <= boundary.getTime());

  if (endsAt && cursor.getTime() > new Date(endsAt).getTime()) return null;
  return cursor.toISOString();
}

export function isValidTimezone(timezone: string): boolean {
  try {
    partsFormatter(timezone).format(new Date());
    return true;
  } catch {
    return false;
  }
}
