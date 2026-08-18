import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getIronSession: vi.fn(),
  findUnique: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("iron-session", () => ({ getIronSession: mocks.getIronSession }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));

import { getCurrentUser, requireUser } from "./auth";

beforeEach(() => {
  mocks.cookies.mockReset().mockResolvedValue({});
  mocks.getIronSession.mockReset();
  mocks.findUnique.mockReset();
  mocks.redirect.mockReset().mockImplementation(() => {
    throw new Error("redirect:/login");
  });
});

test("aktuálnu identitu a rolu číta z databázy, nie zo starej session", async () => {
  mocks.getIronSession.mockResolvedValue({
    userId: "user-1",
    name: "Staré meno",
    email: "old@example.sk",
    role: "admin",
  });
  mocks.findUnique.mockResolvedValue({
    id: "user-1",
    name: "Aktuálne meno",
    email: "new@example.sk",
    role: "FINANCE_OPERATOR",
  });

  await expect(getCurrentUser()).resolves.toEqual({
    userId: "user-1",
    name: "Aktuálne meno",
    email: "new@example.sk",
    role: "FINANCE_OPERATOR",
  });
});

test("session zmazaného používateľa sa považuje za neprihlásenú", async () => {
  mocks.getIronSession.mockResolvedValue({ userId: "deleted-user" });
  mocks.findUnique.mockResolvedValue(null);

  await expect(requireUser()).rejects.toThrow("redirect:/login");
  expect(mocks.redirect).toHaveBeenCalledWith("/login");
});
