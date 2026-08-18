import { expect, test } from "vitest";
import { configuredSecret, secretMatches } from "./secrets";

const secret = "0123456789abcdef0123456789abcdef";

test("vyžaduje aspoň 32-znakové tajomstvo", () => {
  expect(configuredSecret(undefined)).toBe(false);
  expect(configuredSecret("short")).toBe(false);
  expect(configuredSecret(secret)).toBe(true);
});

test("porovná tajomstvo bezpečne a odmietne inú dĺžku aj obsah", () => {
  expect(secretMatches(secret, secret)).toBe(true);
  expect(secretMatches(secret, `${secret}x`)).toBe(false);
  expect(secretMatches(secret, "x".repeat(secret.length))).toBe(false);
});
