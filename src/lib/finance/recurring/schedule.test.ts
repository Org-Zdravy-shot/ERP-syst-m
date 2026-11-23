import { expect, test } from "vitest";
import { scheduledOccurrence, todaySlovakia } from "./schedule";

test("mesačné opakovanie zachová 31. deň aj po kratšom mesiaci", () => {
  const january = new Date("2027-01-31");
  expect(scheduledOccurrence(january, 1, 1).toISOString()).toBe("2027-02-28T00:00:00.000Z");
  expect(scheduledOccurrence(january, 1, 2).toISOString()).toBe("2027-03-31T00:00:00.000Z");
  expect(scheduledOccurrence(new Date("2028-01-31"), 1, 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
});

test("splatný pracovný deň sa určuje podľa slovenského času", () => {
  expect(todaySlovakia(new Date("2026-11-23T23:50:00Z")).toISOString()).toBe("2026-11-24T00:00:00.000Z");
});
