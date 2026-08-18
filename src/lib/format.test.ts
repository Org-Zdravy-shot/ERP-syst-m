import { expect, test } from "vitest";
import { parseEurToCents } from "./format";

test("EUR sumu prevedie na celé centy bez float zvyšku", () => {
  expect(parseEurToCents("1 234,56")).toBe(123_456);
  expect(parseEurToCents("0.10")).toBe(10);
  expect(parseEurToCents("-2,50")).toBe(-250);
});

test("odmietne trailing text, viac než dve desatinné miesta a nekonečno", () => {
  expect(() => parseEurToCents("12abc")).toThrow(/Neplatná suma/);
  expect(() => parseEurToCents("1,234")).toThrow(/Neplatná suma/);
  expect(() => parseEurToCents("Infinity")).toThrow(/Neplatná suma/);
});
