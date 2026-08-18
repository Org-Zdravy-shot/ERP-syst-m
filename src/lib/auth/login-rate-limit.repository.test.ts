import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loginRateLimit: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

import {
  checkLoginRateLimit,
  clearSuccessfulLogin,
  loginRateLimitTargets,
  recordFailedLogin,
} from "./login-rate-limit";

const identity = {
  email: "admin@zdravyshot.sk",
  clientAddress: "1.2.3.4",
};
const now = new Date("2026-08-18T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      loginRateLimit: {
        upsert: mocks.upsert,
        findUniqueOrThrow: mocks.findUniqueOrThrow,
        update: mocks.update,
        deleteMany: mocks.deleteMany,
      },
      auditLog: { create: mocks.auditCreate },
    }),
  );
  mocks.upsert.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

test("kontrola vráti zostávajúci čas najdlhšieho aktívneho bloku", async () => {
  mocks.findMany.mockResolvedValue([
    { blockedUntil: new Date("2026-08-18T12:05:00.000Z") },
    { blockedUntil: new Date("2026-08-18T12:10:00.000Z") },
  ]);

  await expect(checkLoginRateLimit(identity, now)).resolves.toEqual({
    blocked: true,
    retryAfterSeconds: 600,
  });
});

test("prechod na blok sa zapíše atomicky a audituje bez e-mailu alebo IP", async () => {
  mocks.findUniqueOrThrow
    .mockResolvedValueOnce({
      failureCount: 4,
      windowStartedAt: new Date("2026-08-18T11:55:00.000Z"),
      blockedUntil: null,
      expiresAt: new Date("2026-08-18T12:10:00.000Z"),
    })
    .mockResolvedValueOnce({
      failureCount: 0,
      windowStartedAt: now,
      blockedUntil: null,
      expiresAt: now,
    });

  const result = await recordFailedLogin(identity, now);

  expect(result).toEqual({ blocked: true, retryAfterSeconds: 900 });
  expect(mocks.transaction).toHaveBeenCalledOnce();
  expect(mocks.auditCreate).toHaveBeenCalledOnce();
  const audit = mocks.auditCreate.mock.calls[0]?.[0];
  expect(audit.data.action).toBe("LOGIN_RATE_LIMIT_TRIGGERED");
  expect(audit.data.entityId).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(audit)).not.toContain(identity.email);
  expect(JSON.stringify(audit)).not.toContain(identity.clientAddress);
});

test("úspešné prihlásenie zmaže iba limit identity a ponechá IP ochranu", async () => {
  const targets = loginRateLimitTargets(identity);
  const identityTarget = targets.find((target) => target.scope === "IDENTITY_IP");
  const ipTarget = targets.find((target) => target.scope === "IP");

  await clearSuccessfulLogin(identity, now);

  expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
  const identityDelete = mocks.deleteMany.mock.calls[0]?.[0];
  expect(identityDelete.where.keyHash).toBe(identityTarget?.keyHash);
  expect(identityDelete.where.keyHash).not.toBe(ipTarget?.keyHash);
  expect(mocks.deleteMany.mock.calls[1]?.[0].where).not.toHaveProperty(
    "keyHash",
  );
});
