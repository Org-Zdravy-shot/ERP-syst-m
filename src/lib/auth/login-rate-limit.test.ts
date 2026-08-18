import { expect, test } from "vitest";
import {
  LOGIN_RATE_LIMIT_POLICIES,
  loginRateLimitTargets,
  nextLoginFailureState,
} from "./login-rate-limit";

const secret = "test-login-rate-limit-secret-32-characters";
const now = new Date("2026-08-18T12:00:00.000Z");

test("kľúče sú HMAC a neobsahujú surový e-mail ani IP", () => {
  const targets = loginRateLimitTargets(
    { email: "Admin@ZdravyShot.sk", clientAddress: "1.2.3.4" },
    secret,
  );

  expect(targets.map((target) => target.scope)).toEqual([
    "IDENTITY_IP",
    "IP",
  ]);
  for (const target of targets) {
    expect(target.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(target.keyHash).not.toContain("admin");
    expect(target.keyHash).not.toContain("1.2.3.4");
  }
  expect(
    loginRateLimitTargets(
      { email: "admin@zdravyshot.sk", clientAddress: "5.6.7.8" },
      secret,
    )[0]?.keyHash,
  ).not.toBe(targets[0]?.keyHash);
});

test("pri neznámej IP nevytvára globálny IP limit pre všetkých", () => {
  const targets = loginRateLimitTargets(
    { email: "admin@zdravyshot.sk", clientAddress: "unknown" },
    secret,
  );
  expect(targets).toHaveLength(1);
  expect(targets[0]?.scope).toBe("IDENTITY_IP");
});

test("piaty neúspech kombinácie identity a IP spustí 15-minútový blok", () => {
  const state = nextLoginFailureState(
    {
      failureCount: 4,
      windowStartedAt: new Date("2026-08-18T11:55:00.000Z"),
      blockedUntil: null,
      expiresAt: new Date("2026-08-18T12:10:00.000Z"),
    },
    LOGIN_RATE_LIMIT_POLICIES.IDENTITY_IP,
    now,
  );

  expect(state.failureCount).toBe(5);
  expect(state.becameBlocked).toBe(true);
  expect(state.blockedUntil).toEqual(
    new Date("2026-08-18T12:15:00.000Z"),
  );
  expect(state.expiresAt).toEqual(state.blockedUntil);
});

test("po skončení okna začne nový prvý pokus bez starého bloku", () => {
  const state = nextLoginFailureState(
    {
      failureCount: 9,
      windowStartedAt: new Date("2026-08-18T11:00:00.000Z"),
      blockedUntil: new Date("2026-08-18T11:30:00.000Z"),
      expiresAt: new Date("2026-08-18T11:30:00.000Z"),
    },
    LOGIN_RATE_LIMIT_POLICIES.IDENTITY_IP,
    now,
  );

  expect(state.failureCount).toBe(1);
  expect(state.windowStartedAt).toEqual(now);
  expect(state.blockedUntil).toBeNull();
  expect(state.becameBlocked).toBe(false);
});
