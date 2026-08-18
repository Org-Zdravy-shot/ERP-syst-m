import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
  findUnique: vi.fn(),
  getSession: vi.fn(),
  compare: vi.fn(),
  check: vi.fn(),
  recordFailure: vi.fn(),
  clearSuccess: vi.fn(),
  sessionSave: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare } }));
vi.mock("@/lib/auth/login-rate-limit", () => ({
  checkLoginRateLimit: mocks.check,
  recordFailedLogin: mocks.recordFailure,
  clearSuccessfulLogin: mocks.clearSuccess,
}));

import { login } from "./_actions";

function loginForm(email = "admin@zdravyshot.sk", password = "secret") {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(
    new Headers({ "x-forwarded-for": "1.2.3.4" }),
  );
  mocks.check.mockResolvedValue({ blocked: false, retryAfterSeconds: 0 });
  mocks.recordFailure.mockResolvedValue({
    blocked: false,
    retryAfterSeconds: 0,
  });
  mocks.clearSuccess.mockResolvedValue(undefined);
  mocks.getSession.mockResolvedValue({ save: mocks.sessionSave });
  mocks.redirect.mockImplementation(() => {
    throw new Error("redirect:/");
  });
});

test("už zablokovaný pokus skončí pred databázovým lookupom a bcryptom", async () => {
  mocks.check.mockResolvedValue({ blocked: true, retryAfterSeconds: 600 });

  const result = await login({}, loginForm());

  expect(result.error).toMatch(/Príliš veľa/);
  expect(mocks.findUnique).not.toHaveBeenCalled();
  expect(mocks.compare).not.toHaveBeenCalled();
});

test("neznámy používateľ prejde dummy bcryptom a zapíše zlyhanie", async () => {
  mocks.findUnique.mockResolvedValue(null);
  mocks.compare.mockResolvedValue(false);

  await expect(login({}, loginForm())).resolves.toEqual({
    error: "Nesprávny e-mail alebo heslo.",
  });
  expect(mocks.compare).toHaveBeenCalledOnce();
  expect(mocks.recordFailure).toHaveBeenCalledWith({
    email: "admin@zdravyshot.sk",
    clientAddress: "1.2.3.4",
  });
});

test("úspech zmaže limit identity, uloží session a presmeruje", async () => {
  mocks.findUnique.mockResolvedValue({
    id: "admin-1",
    name: "Admin",
    email: "admin@zdravyshot.sk",
    role: "admin",
    passwordHash: "stored-hash",
  });
  mocks.compare.mockResolvedValue(true);
  const session: Record<string, unknown> = { save: mocks.sessionSave };
  mocks.getSession.mockResolvedValue(session);

  await expect(login({}, loginForm())).rejects.toThrow("redirect:/");

  expect(mocks.clearSuccess).toHaveBeenCalledOnce();
  expect(session).toMatchObject({
    userId: "admin-1",
    name: "Admin",
    email: "admin@zdravyshot.sk",
    role: "admin",
  });
  expect(mocks.sessionSave).toHaveBeenCalledOnce();
  expect(mocks.redirect).toHaveBeenCalledWith("/");
});
