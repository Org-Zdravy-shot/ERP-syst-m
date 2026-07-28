const BRATISLAVA_TIME_ZONE = "Europe/Bratislava";

function partsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/**
 * Converts a wall-clock timestamp from Europe/Bratislava to an unambiguous ISO
 * timestamp. VRP2 Excel dates do not contain an offset, so treating them as UTC
 * would move summer sales by two hours.
 */
export function bratislavaDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string {
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = wallClockUtc;

  // Two passes also cover dates around daylight-saving transitions.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = partsInTimeZone(new Date(candidate), BRATISLAVA_TIME_ZONE);
    const renderedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    candidate = wallClockUtc - (renderedAsUtc - candidate);
  }

  return new Date(candidate).toISOString();
}

/** Parses yyyy-mm-ddThh:mm from a datetime-local input as Slovak local time. */
export function parseBratislavaDateTime(value: string): Date | null {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const iso = bratislavaDateTimeToIso(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  );
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
